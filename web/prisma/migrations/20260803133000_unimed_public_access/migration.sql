ALTER TABLE "UnimedImportBatch"
  ALTER COLUMN "requestedById" DROP NOT NULL;

ALTER TABLE "UnimedImportBatch"
  DROP CONSTRAINT IF EXISTS "UnimedImportBatch_requestedById_fkey";

ALTER TABLE "UnimedImportBatch"
  ADD CONSTRAINT "UnimedImportBatch_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UnimedModuleSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "level" "UnimedAccessLevel" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnimedModuleSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnimedModuleSession_tokenHash_key"
  ON "UnimedModuleSession"("tokenHash");
CREATE INDEX "UnimedModuleSession_tenantId_expiresAt_idx"
  ON "UnimedModuleSession"("tenantId", "expiresAt");
CREATE INDEX "UnimedModuleSession_expiresAt_revokedAt_idx"
  ON "UnimedModuleSession"("expiresAt", "revokedAt");

ALTER TABLE "UnimedModuleSession"
  ADD CONSTRAINT "UnimedModuleSession_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
