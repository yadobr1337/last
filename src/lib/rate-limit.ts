import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export async function takeRateLimit(scope: string, identity: string, limit: number, windowMs: number) {
  const digest = createHmac("sha256", env.NEXTAUTH_SECRET).update(identity).digest("hex");
  const key = `${scope}:${digest}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "RateLimit"."expiresAt" END
    WHERE "RateLimit"."expiresAt" <= ${now} OR "RateLimit"."count" < ${limit}
    RETURNING "count"
  `;
  return rows.length > 0;
}
