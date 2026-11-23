import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  applyYooKassaPayment,
  canUseYooKassa,
  fetchYooKassaPayment,
  timingSafeEqual,
  yooKassaPaymentId,
} from "@/lib/yookassa";

const notificationSchema = z.object({
  type: z.literal("notification"),
  event: z.string(),
  object: z.object({ id: yooKassaPaymentId }),
});

export async function POST(request: Request) {
  if (!canUseYooKassa()) {
    return NextResponse.json({ error: "Payments unavailable" }, { status: 503 });
  }
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (
    env.YOOKASSA_WEBHOOK_SECRET &&
    (!secret || !timingSafeEqual(secret, env.YOOKASSA_WEBHOOK_SECRET))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = notificationSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
  }
  const { event, object } = payload.data;
  if (!["payment.succeeded", "payment.canceled", "payment.waiting_for_capture"].includes(event)) {
    return NextResponse.json({ ok: true });
  }

  try {
    const payment = await fetchYooKassaPayment(object.id);
    if (event === "payment.succeeded" && payment.status !== "succeeded") {
      return NextResponse.json({ error: "Payment not confirmed" }, { status: 409 });
    }
    await applyYooKassaPayment(payment);
  } catch {
    console.error("[yookassa] webhook processing failed", { paymentId: object.id });
    return NextResponse.json({ error: "Payment processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
