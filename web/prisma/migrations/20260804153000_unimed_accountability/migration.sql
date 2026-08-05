-- Identificação do operador em sessões públicas já existentes.
ALTER TABLE "UnimedModuleSession"
  ADD COLUMN "operatorName" TEXT;

UPDATE "UnimedModuleSession"
SET "operatorName" = 'Sessão anterior'
WHERE "operatorName" IS NULL;

ALTER TABLE "UnimedModuleSession"
  ALTER COLUMN "operatorName" SET NOT NULL;

-- Histórico técnico de e-mail: não armazena corpo, CPF, nome do beneficiário
-- ou endereços de destinatários.
CREATE TABLE "UnimedEmailEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "moduleSessionId" TEXT,
  "beneficiaryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "operatorName" TEXT NOT NULL,
  "recipientCount" INTEGER,
  "subjectSequence" INTEGER,
  "errorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UnimedEmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnimedEmailEvent_tenantId_idempotencyKey_key"
  ON "UnimedEmailEvent"("tenantId", "idempotencyKey");
CREATE INDEX "UnimedEmailEvent_tenantId_createdAt_idx"
  ON "UnimedEmailEvent"("tenantId", "createdAt");
CREATE INDEX "UnimedEmailEvent_moduleSessionId_createdAt_idx"
  ON "UnimedEmailEvent"("moduleSessionId", "createdAt");

ALTER TABLE "UnimedEmailEvent"
  ADD CONSTRAINT "UnimedEmailEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnimedEmailEvent"
  ADD CONSTRAINT "UnimedEmailEvent_moduleSessionId_fkey"
  FOREIGN KEY ("moduleSessionId") REFERENCES "UnimedModuleSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Rollback seguro, se necessário:
-- DROP TABLE "UnimedEmailEvent";
-- ALTER TABLE "UnimedModuleSession" DROP COLUMN "operatorName";
