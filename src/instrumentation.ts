const globalJobs = globalThis as typeof globalThis & {
  __oneVpnCronStarted?: boolean;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || globalJobs.__oneVpnCronStarted) {
    return;
  }

  const { default: cron } = await import("node-cron");
  const { db } = await import("@/lib/db");
  const { runLifecycleSweep } = await import("@/lib/billing");
  const { processNotifications } = await import("@/lib/notifications");
  const { reconcileYooKassaPayments } = await import("@/lib/yookassa");
  const { withWorkLease } = await import("@/lib/work-lease");
  await db.$queryRaw`PRAGMA journal_mode = WAL`;

  globalJobs.__oneVpnCronStarted = true;
  cron.schedule("* * * * *", () => runLifecycleSweep().catch(() => {
    console.error("[cron] lifecycle sweep failed");
  }), { noOverlap: true });
  cron.schedule("* * * * *", () => processNotifications().catch(() => {
    console.error("[cron] Telegram queue failed");
  }), { noOverlap: true });
  cron.schedule("*/5 * * * *", () => withWorkLease("payment-reconciliation", 120_000, reconcileYooKassaPayments)
    .catch(() => console.error("[cron] payment reconciliation failed")), { noOverlap: true });
  cron.schedule("19 * * * *", async () => {
    await withWorkLease("expired-auth-artifacts", 60_000, async () => {
      const now = new Date();
      await db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
      await db.verificationToken.deleteMany({ where: { expires: { lt: now } } });
    }).catch(() => console.error("[cron] authentication cleanup failed"));
  }, { noOverlap: true });
}
