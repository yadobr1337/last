import { Role } from "@prisma/client";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { db, writeTransaction } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";
import { getSettings } from "@/lib/settings";
import { ensureUserSquad } from "@/lib/squads";
import { sendTelegramMessage, verifyTelegramAuth, verifyTelegramMiniAppAuth } from "@/lib/telegram";
import { DEFAULT_HWID_DEVICE_LIMIT } from "@/lib/site";
import { ensureUserPublicId } from "@/lib/user-identity";
import { takeRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";

async function getSessionUser(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, role: true, balanceKopeks: true, telegramId: true,
      subscriptionUrl: true, publicId: true, isEmailPlaceholder: true, emailVerified: true,
      isBanned: true, authVersion: true,
    },
  });

  if (!user || user.isBanned) {
    return null;
  }

  const publicId = user.publicId ?? await ensureUserPublicId(user.id);

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    balanceKopeks: user.balanceKopeks,
    telegramId: user.telegramId,
    subscriptionUrl: user.subscriptionUrl,
    publicId,
    isEmailPlaceholder: user.isEmailPlaceholder,
    emailVerified: user.emailVerified?.toISOString() ?? null,
    authVersion: user.authVersion,
  };
}

async function upsertTelegramUser(params: {
  id: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
}) {
  const placeholderEmail = `telegram-${params.id}@1vpn.local`;

  return writeTransaction(
    async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          OR: [
            { telegramId: params.id },
            { email: placeholderEmail, isEmailPlaceholder: true, telegramId: null },
          ],
        },
      });

      const linkedNow = !existing?.telegramId;

      const persisted = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              telegramId: params.id,
              telegramFirstName: params.firstName,
              telegramUsername: params.username,
              telegramPhotoUrl: params.photoUrl,
              email: existing.isEmailPlaceholder ? placeholderEmail : existing.email,
              isEmailPlaceholder: existing.isEmailPlaceholder,
            },
          })
        : await tx.user.create({
            data: {
              email: placeholderEmail,
              role: Role.USER,
              telegramId: params.id,
              telegramFirstName: params.firstName,
              telegramUsername: params.username,
              telegramPhotoUrl: params.photoUrl,
              isEmailPlaceholder: true,
              hwidDeviceLimit: DEFAULT_HWID_DEVICE_LIMIT,
            },
          });

      await ensureUserSquad(persisted.id, tx);
      return { persisted, linkedNow };
    },
  );
}

export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        if (!email || email.length > 254 || !credentials?.password || credentials.password.length > 128) {
          return null;
        }
        if (!await takeRateLimit("password-login", email, 15, 15 * 60_000)) return null;

        const user = await db.user.findUnique({
          where: { email },
        });

        if (!user?.passwordHash || user.isEmailPlaceholder || user.isBanned) {
          return null;
        }

        const isValid = await verifyPassword(credentials.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return getSessionUser(user.id);
      },
    }),
    CredentialsProvider({
      id: "telegram",
      name: "Telegram",
      credentials: {
        id: { label: "Telegram ID", type: "text" },
        first_name: { label: "First name", type: "text" },
        username: { label: "Username", type: "text" },
        photo_url: { label: "Photo URL", type: "text" },
        auth_date: { label: "Auth date", type: "text" },
        hash: { label: "Hash", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) {
          throw new Error("Telegram payload is missing.");
        }

        const verification = await verifyTelegramAuth({
          id: credentials.id,
          first_name: credentials.first_name,
          username: credentials.username,
          photo_url: credentials.photo_url,
          auth_date: credentials.auth_date,
          hash: credentials.hash,
        });

        if (!verification.ok) {
          throw new Error(verification.error);
        }
        if (!await takeRateLimit("telegram-widget-proof", credentials.hash, 1, 6 * 60_000)) return null;

        const { persisted, linkedNow } = await upsertTelegramUser(verification.data);
        if (linkedNow) {
          await sendTelegramMessage(
            verification.data.id,
            "<b>1VPN</b>\nTelegram подключен. Уведомления о балансе и подписке включены.",
          );
        }
        return getSessionUser(persisted.id);
      },
    }),
    CredentialsProvider({
      id: "telegram-mini",
      name: "Telegram Mini App",
      credentials: {
        initData: { label: "Mini app initData", type: "text" },
      },
      async authorize(credentials) {
        const initData = credentials?.initData;
        if (!initData) {
          throw new Error("Telegram Mini App payload is missing.");
        }

        const verification = await verifyTelegramMiniAppAuth(initData);
        if (!verification.ok) {
          throw new Error(verification.error);
        }
        const hash = new URLSearchParams(initData).get("hash");
        if (!hash || !await takeRateLimit("telegram-mini-proof", hash, 1, 6 * 60_000)) return null;

        const { persisted, linkedNow } = await upsertTelegramUser(verification.data);
        if (linkedNow) {
          await sendTelegramMessage(
            verification.data.id,
            "<b>1VPN</b>\nTelegram подключен. Уведомления о балансе и подписке включены.",
          );
        }
        return getSessionUser(persisted.id);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      const userId = token.id ?? token.sub;
      if (!userId) {
        return token;
      }

      const freshUser = await getSessionUser(String(userId));
      if (!freshUser || (!user && (token.authVersion ?? 0) !== freshUser.authVersion)) {
        return {};
      }

      token.authVersion = freshUser.authVersion;
      token.role = freshUser.role;
      token.balanceKopeks = freshUser.balanceKopeks;
      token.telegramId = freshUser.telegramId;
      token.subscriptionUrl = freshUser.subscriptionUrl;
      token.publicId = freshUser.publicId;
      token.isEmailPlaceholder = freshUser.isEmailPlaceholder;
      token.emailVerified = freshUser.emailVerified;
      token.email = freshUser.email;

      return token;
    },
    async session({ session, token }) {
      if (!session.user) {
        return session;
      }

      session.user.id = String(token.id ?? token.sub ?? "");
      session.user.role = token.role ?? Role.USER;
      session.user.balanceKopeks = token.balanceKopeks ?? 0;
      session.user.telegramId = token.telegramId;
      session.user.subscriptionUrl = token.subscriptionUrl;
      session.user.publicId = token.publicId;
      session.user.isEmailPlaceholder = token.isEmailPlaceholder ?? false;
      session.user.emailVerified = token.emailVerified ?? null;
      session.user.email = String(token.email ?? session.user.email ?? "");

      return session;
    },
  },
};

export async function getAuthSession() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session : null;
}

export async function requireUser() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  if (session.user.role !== Role.ADMIN && (await getSettings()).maintenanceEnabled) {
    redirect("/maintenance");
  }

  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  return session;
}
