BEGIN IMMEDIATE;

-- AlterTable
ALTER TABLE "ProvisioningJob" ADD COLUMN "orderAttemptedAt" DATETIME;
ALTER TABLE "ProvisioningJob" ADD COLUMN "quotedCostMinor" INTEGER;

-- CreateTable
CREATE TABLE "WorkLease" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "billingRemainder" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "remnawaveUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "vpnSyncAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "vpnSyncRevision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "User_vpnSyncAt_id_idx" ON "User"("vpnSyncAt", "id");
CREATE INDEX "User_isBanned_lastBillingAt_idx" ON "User"("isBanned", "lastBillingAt");

ALTER TABLE "NotificationEvent" ADD COLUMN "deliveryText" TEXT;
ALTER TABLE "NotificationEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationEvent" ADD COLUMN "nextAttemptAt" DATETIME;
CREATE INDEX "NotificationEvent_nextAttemptAt_idx" ON "NotificationEvent"("nextAttemptAt");

UPDATE "User"
SET "vpnSyncAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE "balanceKopeks" > 0 OR "remnawaveUserUuid" IS NOT NULL
   OR "removalScheduledAt" IS NOT NULL;

-- CreateIndex
CREATE INDEX "WorkLease_expiresAt_idx" ON "WorkLease"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_createdAt_idx" ON "AdminAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ProvisioningJob_orderAttemptedAt_idx" ON "ProvisioningJob"("orderAttemptedAt");


COMMIT;
