-- Shared operational access has no individual account identity.
ALTER TABLE "EscalaRevision" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "EscalaRevision" ADD COLUMN "accessChannel" TEXT NOT NULL DEFAULT 'ACCOUNT';
ALTER TABLE "EscalaRevision" ADD COLUMN "moduleSessionId" TEXT;

CREATE TABLE "EscalaModuleSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EscalaModuleSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EscalaModuleSession_tokenHash_key" ON "EscalaModuleSession"("tokenHash");
CREATE INDEX "EscalaModuleSession_tenantId_expiresAt_idx" ON "EscalaModuleSession"("tenantId", "expiresAt");
CREATE INDEX "EscalaModuleSession_expiresAt_revokedAt_idx" ON "EscalaModuleSession"("expiresAt", "revokedAt");
ALTER TABLE "EscalaModuleSession" ADD CONSTRAINT "EscalaModuleSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
