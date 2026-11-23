-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" DATETIME,
    "pendingEmail" TEXT,
    "passwordlessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isEmailPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramFirstName" TEXT,
    "telegramPhotoUrl" TEXT,
    "telegramBotConfirmedAt" DATETIME,
    "balanceKopeks" INTEGER NOT NULL DEFAULT 0,
    "billingCarryMicros" BIGINT NOT NULL DEFAULT 0,
    "billingStartedAt" DATETIME,
    "lastBillingAt" DATETIME,
    "billingCycle" INTEGER NOT NULL DEFAULT 0,
    "subscriptionEndedAt" DATETIME,
    "removalScheduledAt" DATETIME,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" DATETIME,
    "trialClaimedAt" DATETIME,
    "hwidDeviceLimit" INTEGER,
    "vpnProvisionState" TEXT NOT NULL DEFAULT 'PENDING',
    "vpnStatusMessage" TEXT,
    "remnawaveUserUuid" TEXT,
    "remnawaveShortUuid" TEXT,
    "subscriptionUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "squadId" TEXT,
    CONSTRAINT "User_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yookassa',
    "providerPaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "amountKopeks" INTEGER NOT NULL,
    "confirmationUrl" TEXT,
    "description" TEXT NOT NULL,
    "creditedAt" DATETIME,
    "providerPayload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "memberLimit" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remnawaveInternalSquadUuid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProvisioningJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationKey" TEXT NOT NULL,
    "groupKey" TEXT,
    "groupIndex" INTEGER,
    "nodeIndex" INTEGER,
    "locationName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "serverId" TEXT,
    "serverIp" TEXT,
    "remnawaveConfigProfileUuid" TEXT,
    "remnawaveInboundUuid" TEXT,
    "remnawaveNodeUuid" TEXT,
    "remnawaveHostUuid" TEXT,
    "squadId" TEXT,
    "remnawaveInternalSquadUuid" TEXT,
    "lastError" TEXT,
    "logs" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BalanceTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountKopeks" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "siteName" TEXT NOT NULL DEFAULT '1VPN',
    "pricePerDayKopeks" INTEGER NOT NULL DEFAULT 4900,
    "trialDays" INTEGER NOT NULL DEFAULT 1,
    "deletionGraceHours" INTEGER NOT NULL DEFAULT 24,
    "defaultHwidDeviceLimit" INTEGER NOT NULL DEFAULT 1,
    "captchaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paymentsMode" TEXT NOT NULL DEFAULT 'demo',
    "supportTelegramUrl" TEXT,
    "heroAnnouncement" TEXT,
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "defaultsVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_remnawaveUserUuid_key" ON "User"("remnawaveUserUuid");

-- CreateIndex
CREATE UNIQUE INDEX "User_remnawaveShortUuid_key" ON "User"("remnawaveShortUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Squad_name_key" ON "Squad"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Squad_slug_key" ON "Squad"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Squad_remnawaveInternalSquadUuid_key" ON "Squad"("remnawaveInternalSquadUuid");

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningJob_locationKey_key" ON "ProvisioningJob"("locationKey");

-- CreateIndex
CREATE INDEX "ProvisioningJob_status_updatedAt_idx" ON "ProvisioningJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProvisioningJob_groupKey_idx" ON "ProvisioningJob"("groupKey");

-- CreateIndex
CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_userId_createdAt_idx" ON "NotificationEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_userId_type_cycleKey_key" ON "NotificationEvent"("userId", "type", "cycleKey");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
