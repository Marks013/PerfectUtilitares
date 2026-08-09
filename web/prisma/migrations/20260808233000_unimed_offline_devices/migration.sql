CREATE TABLE "UnimedOfflineDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userAgentHash" TEXT NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offlineExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedOfflineDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnimedOfflineDevice_tenantId_deviceKey_key"
ON "UnimedOfflineDevice"("tenantId", "deviceKey");

CREATE INDEX "UnimedOfflineDevice_tenantId_revokedAt_lastSeenAt_idx"
ON "UnimedOfflineDevice"("tenantId", "revokedAt", "lastSeenAt");

CREATE INDEX "UnimedOfflineDevice_offlineExpiresAt_idx"
ON "UnimedOfflineDevice"("offlineExpiresAt");

ALTER TABLE "UnimedOfflineDevice"
ADD CONSTRAINT "UnimedOfflineDevice_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PdfJob" ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "PdfJob_tenantId_requestKey_key"
ON "PdfJob"("tenantId", "requestKey");
