import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCaptchaToken } from "@/lib/captcha";
import { writeTransaction } from "@/lib/db";
import {
  buildEmailVerificationIdentifier,
  issueEmailCode,
} from "@/lib/email-codes";
import { hashPassword } from "@/lib/passwords";
import { getSettings } from "@/lib/settings";
import { DEFAULT_HWID_DEVICE_LIMIT } from "@/lib/site";
import { ensureUserSquad } from "@/lib/squads";
import { ensureUserPublicId } from "@/lib/user-identity";

const registerSchema = z
  .object({
    email: z.string().trim().max(254).email().refine((value) => !value.toLowerCase().endsWith("@1vpn.local")),
    password: z.string().min(8).max(64).refine((value) => Buffer.byteLength(value) <= 72),
    captchaToken: z.string().max(8192).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const input = registerSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Проверьте поля формы." }, { status: 400 });
  const payload = input.data;
  const settings = await getSettings();

  if (settings.maintenanceEnabled) {
    return NextResponse.json(
      { error: "Регистрация временно недоступна из-за технических работ." },
      { status: 503 },
    );
  }

  if (settings.captchaEnabled) {
    const captchaOk = await verifyCaptchaToken(payload.captchaToken);
    if (!captchaOk) {
      return NextResponse.json(
        { error: "Пройдите CAPTCHA перед регистрацией." },
        { status: 400 },
      );
    }
  }

  const passwordHash = await hashPassword(payload.password);

  const user = await writeTransaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: payload.email.toLowerCase(),
        pendingEmail: payload.email.toLowerCase(),
        passwordHash,
        role: Role.USER,
        hwidDeviceLimit: DEFAULT_HWID_DEVICE_LIMIT,
      },
    });

    await ensureUserSquad(created.id, tx);
    return created;
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" && Array.isArray(error.meta?.target) &&
        error.meta.target.includes("email")) return null;
    throw error;
  });
  if (!user) return NextResponse.json({ error: "Email is already registered." }, { status: 409 });

  const publicId = await ensureUserPublicId(user.id);

  try {
    await issueEmailCode({
      identifier: buildEmailVerificationIdentifier(user.id, user.email),
      email: user.email,
      subject: "1VPN: код подтверждения email",
      title: "Подтвердите регистрацию",
      description:
        "Введите код в настройках аккаунта, чтобы подтвердить email и включить вход по одноразовым кодам.",
    });
  } catch {
    return NextResponse.json({ ok: true, userId: user.id, publicId, emailCodeSent: false });
  }

  return NextResponse.json({ ok: true, userId: user.id, publicId, emailCodeSent: true });
}
