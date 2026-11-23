import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { db, writeTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { creditBalance } from "@/lib/billing";
import { MAX_BALANCE_KOPEKS, parseRubleAmount } from "@/lib/money";

export type YooKassaPaymentMethod = "bank_card" | "sbp";

export const yooKassaPaymentId = z.string().regex(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
const paymentSchema = z.object({
  id: yooKassaPaymentId,
  status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
  paid: z.boolean(),
  test: z.boolean(),
  amount: z.object({ value: z.string().regex(/^\d{1,9}\.\d{2}$/), currency: z.literal("RUB") }),
  recipient: z.object({ account_id: z.string() }),
  confirmation: z.object({ confirmation_url: z.url().optional() }).optional(),
  metadata: z.object({ localPaymentId: z.string().min(1).max(64), userId: z.string().min(1).max(64) }).optional(),
});
type YooKassaPayment = z.infer<typeof paymentSchema>;

function isConfigured() {
  const key = env.YOOKASSA_SECRET_KEY;
  return Boolean(env.YOOKASSA_SHOP_ID?.match(/^\d+$/) && key?.trim() &&
    (process.env.NODE_ENV !== "production" || key.startsWith("live_")));
}

function getAuthHeader() {
  if (!isConfigured()) {
    throw new Error("YooKassa is not configured.");
  }

  return `Basic ${Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString("base64")}`;
}

function getReturnUrl() {
  return env.YOOKASSA_RETURN_URL ?? `${env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? ""}/dashboard`;
}

function kopeksToRubles(amountKopeks: number) {
  return (amountKopeks / 100).toFixed(2);
}

async function requestYooKassa(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.yookassa.ru/v3${path}`, {
    ...init,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`YooKassa request failed: HTTP ${response.status}`);
  }

  return paymentSchema.parse(await response.json());
}

export function canUseYooKassa() {
  return isConfigured();
}

export async function createYooKassaPayment(params: {
  userId: string;
  amountKopeks: number;
  method: YooKassaPaymentMethod;
}) {
  if (!isConfigured()) {
    throw new Error("YooKassa is not configured.");
  }

  if (!Number.isInteger(params.amountKopeks) || params.amountKopeks < 1_000 ||
      params.amountKopeks > MAX_BALANCE_KOPEKS) {
    throw new Error("Payment amount is out of range.");
  }
  const returnUrl = new URL(getReturnUrl());
  if (process.env.NODE_ENV === "production" && returnUrl.protocol !== "https:") {
    throw new Error("YooKassa return URL must use HTTPS.");
  }

  const localPayment = await db.payment.create({
    data: {
      userId: params.userId,
      method: params.method,
      amountKopeks: params.amountKopeks,
      description: `YooKassa ${params.method === "sbp" ? "SBP" : "card"} top-up`,
    },
  });

  const payment = await requestYooKassa("/payments", {
    method: "POST",
    headers: {
      "Idempotence-Key": localPayment.id,
    },
    body: JSON.stringify({
      amount: {
        value: kopeksToRubles(params.amountKopeks),
        currency: "RUB",
      },
      capture: true,
      payment_method_data: {
        type: params.method,
      },
      confirmation: {
        type: "redirect",
        return_url: returnUrl.href,
      },
      description: `1VPN: пополнение баланса на ${kopeksToRubles(params.amountKopeks)} RUB`,
      metadata: {
        localPaymentId: localPayment.id,
        userId: params.userId,
      },
    }),
  });

  if (payment.metadata?.localPaymentId !== localPayment.id) {
    throw new Error("YooKassa returned a different local order.");
  }
  await applyYooKassaPayment(payment);
  if (payment.status === "succeeded") return returnUrl.href;
  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!confirmationUrl || new URL(confirmationUrl).protocol !== "https:") {
    throw new Error("YooKassa did not return a confirmation URL.");
  }

  return confirmationUrl;
}

export async function fetchYooKassaPayment(paymentId: string) {
  const id = yooKassaPaymentId.parse(paymentId);
  const payment = await requestYooKassa(`/payments/${id}`);
  if (payment.id !== id) throw new Error("YooKassa returned a different payment ID.");
  return payment;
}

export async function applyYooKassaPayment(payment: YooKassaPayment) {
  payment = paymentSchema.parse(payment);
  if (!isConfigured() || payment.recipient.account_id !== env.YOOKASSA_SHOP_ID ||
      (process.env.NODE_ENV === "production" && payment.test)) {
    throw new Error("Unexpected YooKassa shop or payment environment.");
  }
  const metadata = payment.metadata;
  // A merchant may have payments belonging to other applications.
  if (!metadata) return { credited: false };
  const amountKopeks = parseRubleAmount(payment.amount.value);
  const isPaid = payment.status === "succeeded" && payment.paid;
  if (payment.status === "succeeded" && !isPaid) {
    throw new Error("YooKassa payment status is inconsistent.");
  }

  return writeTransaction(async (tx) => {
    const local = await tx.payment.findUnique({ where: { id: metadata.localPaymentId } });
    if (!local || local.provider !== "yookassa" || local.userId !== metadata.userId ||
        (local.providerPaymentId && local.providerPaymentId !== payment.id) ||
        local.amountKopeks !== amountKopeks) {
      throw new Error("YooKassa payment does not match the local order.");
    }
    if (local.creditedAt || (local.status === "CANCELED" && !isPaid)) {
      return { credited: false };
    }

    const claimed = await tx.payment.updateMany({
      where: { id: local.id, creditedAt: null },
      data: {
        providerPaymentId: payment.id,
        status: payment.status.toUpperCase(),
        confirmationUrl: payment.confirmation?.confirmation_url,
        providerPayload: { status: payment.status, paid: payment.paid, test: payment.test },
        creditedAt: isPaid ? new Date() : undefined,
      },
    });
    if (!claimed.count || !isPaid) return { credited: false };

    await creditBalance(tx, {
      userId: local.userId,
      amountKopeks,
      description: `YooKassa payment ${payment.id}`,
      notificationKey: `yookassa:${local.id}`,
    });
    return { credited: true };
  });
}

export async function reconcileYooKassaPayments() {
  if (!isConfigured()) return;
  const orders = await db.payment.findMany({
    where: {
      provider: "yookassa",
      providerPaymentId: { not: null },
      creditedAt: null,
      status: { in: ["PENDING", "WAITING_FOR_CAPTURE", "SUCCEEDED"] },
      updatedAt: { lte: new Date(Date.now() - 10 * 60_000) },
    },
    select: { id: true, providerPaymentId: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  for (const order of orders) {
    if (!order.providerPaymentId) continue;
    try {
      await applyYooKassaPayment(await fetchYooKassaPayment(order.providerPaymentId));
    } catch {
      console.error("[yookassa] scheduled reconciliation failed", { orderId: order.id });
    } finally {
      await db.payment.updateMany({
        where: { id: order.id, creditedAt: null, updatedAt: order.updatedAt },
        data: { updatedAt: new Date() },
      });
    }
  }
}

export function timingSafeEqual(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
