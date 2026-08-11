CREATE TABLE "UnimedExcelDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedExcelDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnimedExcelDevice_tokenHash_key"
ON "UnimedExcelDevice"("tokenHash");

CREATE INDEX "UnimedExcelDevice_tenantId_revokedAt_expiresAt_idx"
ON "UnimedExcelDevice"("tenantId", "revokedAt", "expiresAt");

ALTER TABLE "UnimedExcelDevice"
ADD CONSTRAINT "UnimedExcelDevice_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
