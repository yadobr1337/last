import { writeTransaction } from "@/lib/db";

const id = process.env.SITE1VPN_TEST_PAYMENT_ID;
if (!id || process.env.SITE1VPN_TEST_CHILD !== "1") throw new Error("Test fixture only.");

void writeTransaction(async (tx) => {
  await tx.payment.update({ where: { id }, data: { creditedAt: new Date(), status: "SUCCEEDED" } });
  process.exit(78);
}).catch(() => process.exit(79));
