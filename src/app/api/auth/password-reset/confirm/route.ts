import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildPasswordResetIdentifier, consumeEmailCode } from "@/lib/email-codes";
import { hashPassword } from "@/lib/passwords";

const schema = z.object({
  email: z.string().trim().max(254).email(),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(8).max(64).refine((value) => Buffer.byteLength(value) <= 72),
});

export async function POST(request: Request) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Проверьте поля формы." }, { status: 400 });
  const payload = input.data;
  const email = payload.email.toLowerCase();

  const user = await db.user.findUnique({
    where: { email, emailVerified: { not: null }, isEmailPlaceholder: false, isBanned: false },
    select: {
      id: true,
      authVersion: true,
    },
  });

  const isValid = user && await consumeEmailCode(buildPasswordResetIdentifier(email), payload.code, async (tx) => {
    await tx.user.update({
      where: { id: user.id, email, authVersion: user.authVersion, emailVerified: { not: null }, isBanned: false },
      data: {
        passwordHash: await hashPassword(payload.password),
        authVersion: { increment: 1 },
      },
    });
  });
  if (!isValid) {
    return NextResponse.json({ error: "Неверный или просроченный код." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
