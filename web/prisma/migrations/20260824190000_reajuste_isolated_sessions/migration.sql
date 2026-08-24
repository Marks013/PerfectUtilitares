CREATE TABLE "ReajusteSalarialSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "operatorName" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReajusteSalarialSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReajusteSalarialSession_tokenHash_key"
  ON "ReajusteSalarialSession"("tokenHash");

CREATE INDEX "ReajusteSalarialSession_tenantId_expiresAt_idx"
  ON "ReajusteSalarialSession"("tenantId", "expiresAt");

CREATE INDEX "ReajusteSalarialSession_expiresAt_revokedAt_idx"
  ON "ReajusteSalarialSession"("expiresAt", "revokedAt");

ALTER TABLE "ReajusteSalarialSession"
  ADD CONSTRAINT "ReajusteSalarialSession_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
