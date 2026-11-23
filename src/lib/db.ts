import { Prisma, PrismaClient } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export async function writeTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Obtain the SQLite write reservation before reading a financial snapshot.
        await tx.$executeRaw`UPDATE "SystemSettings" SET "id" = "id" WHERE "id" = 'default'`;
        return work(tx);
      }, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      if (
        attempt === 4 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P1008", "P2034"].includes(error.code)
      ) {
        throw error;
      }
      await delay(attempt * 75 + Math.floor(Math.random() * 50));
    }
  }
}
