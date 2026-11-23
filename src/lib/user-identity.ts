import { randomInt } from "node:crypto";
import { db, writeTransaction } from "@/lib/db";

export async function ensureUserPublicId(userId: string) {
  return writeTransaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
    if (user.publicId) return user.publicId;

    for (let attempt = 0; attempt < 20; attempt++) {
      const publicId = String(randomInt(10_000_000, 100_000_000));
      if (await tx.user.findUnique({ where: { publicId }, select: { id: true } })) continue;
      await tx.user.update({ where: { id: userId }, data: { publicId } });
      return publicId;
    }
    throw new Error("Failed to generate a unique public ID.");
  });
}

export async function resolveUserIdentifier(rawIdentifier: string) {
  const identifier = rawIdentifier.trim();
  if (!identifier) {
    throw new Error("User identifier is required.");
  }

  const user = await db.user.findFirst({
    where: {
      OR: [{ id: identifier }, { publicId: identifier }, { email: identifier.toLowerCase() }],
    },
    select: { id: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  return user.id;
}
