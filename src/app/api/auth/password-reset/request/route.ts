import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildPasswordResetIdentifier, issueEmailCode } from "@/lib/email-codes";

const schema = z.object({
  email: z.string().trim().max(254).email(),
});

export async function POST(request: Request) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Проверьте email." }, { status: 400 });
  const email = input.data.email.toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: {
      isEmailPlaceholder: true,
      emailVerified: true,
      passwordHash: true,
      isBanned: true,
    },
  });

  if (user?.emailVerified && !user.isEmailPlaceholder && user.passwordHash && !user.isBanned) {
    after(async () => {
      await issueEmailCode({
        identifier: buildPasswordResetIdentifier(email),
        email,
        subject: "1VPN: код для сброса пароля",
        title: "Сброс пароля",
        description: "Введите этот код на странице входа и задайте новый пароль для аккаунта.",
      }).catch(() => undefined);
    });
  }

  return NextResponse.json({ ok: true });
}
