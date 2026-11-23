import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export async function withWorkLease<T>(
  key: string,
  durationMs: number,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const owner = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  const claimed = await db.$executeRaw`
    INSERT INTO "WorkLease" ("key", "owner", "expiresAt")
    VALUES (${key}, ${owner}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "owner" = excluded."owner", "expiresAt" = excluded."expiresAt"
    WHERE "WorkLease"."expiresAt" <= ${now}
  `;

  if (!claimed) return;

  try {
    return await work();
  } finally {
    await db.workLease.deleteMany({ where: { key, owner } }).catch(() => {
      console.error("[lease] release failed");
    });
  }
}
