DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "UnimedImportBatch" b
    JOIN "UnimedCompetency" c ON c.id = b."competencyId"
    WHERE b."tenantId" <> c."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedImportBatch possui competência de outro tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM "UnimedImportSnapshot" s
    JOIN "UnimedCompetency" c ON c.id = s."competencyId"
    WHERE s."tenantId" <> c."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedImportSnapshot possui competência de outro tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM "UnimedPayrollLoan" p
    JOIN "UnimedCompetency" c ON c.id = p."competencyId"
    WHERE p."tenantId" <> c."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "UnimedPayrollLoan" p
    JOIN "UnimedImportBatch" b ON b.id = p."importBatchId"
    WHERE p."tenantId" <> b."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "UnimedPayrollLoan" p
    JOIN "UnimedBeneficiary" b ON b.id = p."beneficiaryId"
    WHERE p."tenantId" <> b."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedPayrollLoan possui vínculo com outro tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM "UnimedBeneficiary" b
    JOIN "UnimedCompetency" c ON c.id = b."competencyId"
    WHERE b."tenantId" <> c."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "UnimedBeneficiary" b
    JOIN "UnimedBranch" r ON r.id = b."branchId"
    WHERE b."tenantId" <> r."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "UnimedBeneficiary" b
    JOIN "UnimedBeneficiary" h ON h.id = b."holderId"
    WHERE b."tenantId" <> h."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedBeneficiary possui vínculo com outro tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM "UnimedInvoiceItem" i
    JOIN "UnimedCompetency" c ON c.id = i."competencyId"
    JOIN "UnimedBranch" b ON b.id = i."branchId"
    WHERE c."tenantId" <> b."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "UnimedInvoiceItem" i
    JOIN "UnimedCompetency" c ON c.id = i."competencyId"
    JOIN "UnimedBeneficiary" b ON b.id = i."beneficiaryId"
    WHERE c."tenantId" <> b."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedInvoiceItem possui vínculo com outro tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM "UnimedPlanPriceVersion" p
    JOIN "UnimedAgeBracket" a ON a.id = p."ageBracketId"
    WHERE p."tenantId" <> a."tenantId"
  ) THEN RAISE EXCEPTION 'UnimedPlanPriceVersion possui faixa de outro tenant'; END IF;
END $$;

ALTER TABLE "UnimedInvoiceItem" ADD COLUMN "tenantId" TEXT;

UPDATE "UnimedInvoiceItem" i
SET "tenantId" = c."tenantId"
FROM "UnimedCompetency" c
WHERE c.id = i."competencyId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UnimedInvoiceItem" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Não foi possível determinar o tenant de todos os itens de fatura';
  END IF;
END $$;

ALTER TABLE "UnimedInvoiceItem" ALTER COLUMN "tenantId" SET NOT NULL;

CREATE UNIQUE INDEX "UnimedCompetency_tenantId_id_key" ON "UnimedCompetency"("tenantId", "id");
CREATE UNIQUE INDEX "UnimedImportBatch_tenantId_id_key" ON "UnimedImportBatch"("tenantId", "id");
CREATE UNIQUE INDEX "UnimedBranch_tenantId_id_key" ON "UnimedBranch"("tenantId", "id");
CREATE UNIQUE INDEX "UnimedBeneficiary_tenantId_id_key" ON "UnimedBeneficiary"("tenantId", "id");
CREATE UNIQUE INDEX "UnimedAgeBracket_tenantId_id_key" ON "UnimedAgeBracket"("tenantId", "id");
CREATE INDEX "UnimedInvoiceItem_tenantId_competencyId_idx" ON "UnimedInvoiceItem"("tenantId", "competencyId");

ALTER TABLE "UnimedImportBatch" DROP CONSTRAINT "UnimedImportBatch_competencyId_fkey";
ALTER TABLE "UnimedImportSnapshot" DROP CONSTRAINT "UnimedImportSnapshot_competencyId_fkey";
ALTER TABLE "UnimedPayrollLoan" DROP CONSTRAINT "UnimedPayrollLoan_competencyId_fkey";
ALTER TABLE "UnimedPayrollLoan" DROP CONSTRAINT "UnimedPayrollLoan_importBatchId_fkey";
ALTER TABLE "UnimedPayrollLoan" DROP CONSTRAINT "UnimedPayrollLoan_beneficiaryId_fkey";
ALTER TABLE "UnimedBeneficiary" DROP CONSTRAINT "UnimedBeneficiary_competencyId_fkey";
ALTER TABLE "UnimedBeneficiary" DROP CONSTRAINT "UnimedBeneficiary_branchId_fkey";
ALTER TABLE "UnimedBeneficiary" DROP CONSTRAINT "UnimedBeneficiary_holderId_fkey";
ALTER TABLE "UnimedInvoiceItem" DROP CONSTRAINT "UnimedInvoiceItem_competencyId_fkey";
ALTER TABLE "UnimedInvoiceItem" DROP CONSTRAINT "UnimedInvoiceItem_branchId_fkey";
ALTER TABLE "UnimedInvoiceItem" DROP CONSTRAINT "UnimedInvoiceItem_beneficiaryId_fkey";
ALTER TABLE "UnimedPlanPriceVersion" DROP CONSTRAINT "UnimedPlanPriceVersion_ageBracketId_fkey";

ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnimedImportBatch" ADD CONSTRAINT "UnimedImportBatch_tenantId_competencyId_fkey"
  FOREIGN KEY ("tenantId", "competencyId") REFERENCES "UnimedCompetency"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnimedImportSnapshot" ADD CONSTRAINT "UnimedImportSnapshot_tenantId_competencyId_fkey"
  FOREIGN KEY ("tenantId", "competencyId") REFERENCES "UnimedCompetency"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_tenantId_competencyId_fkey"
  FOREIGN KEY ("tenantId", "competencyId") REFERENCES "UnimedCompetency"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_tenantId_importBatchId_fkey"
  FOREIGN KEY ("tenantId", "importBatchId") REFERENCES "UnimedImportBatch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_tenantId_beneficiaryId_fkey"
  FOREIGN KEY ("tenantId", "beneficiaryId") REFERENCES "UnimedBeneficiary"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_tenantId_competencyId_fkey"
  FOREIGN KEY ("tenantId", "competencyId") REFERENCES "UnimedCompetency"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_tenantId_branchId_fkey"
  FOREIGN KEY ("tenantId", "branchId") REFERENCES "UnimedBranch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_tenantId_holderId_fkey"
  FOREIGN KEY ("tenantId", "holderId") REFERENCES "UnimedBeneficiary"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_tenantId_competencyId_fkey"
  FOREIGN KEY ("tenantId", "competencyId") REFERENCES "UnimedCompetency"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_tenantId_branchId_fkey"
  FOREIGN KEY ("tenantId", "branchId") REFERENCES "UnimedBranch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_tenantId_beneficiaryId_fkey"
  FOREIGN KEY ("tenantId", "beneficiaryId") REFERENCES "UnimedBeneficiary"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnimedPlanPriceVersion" ADD CONSTRAINT "UnimedPlanPriceVersion_tenantId_ageBracketId_fkey"
  FOREIGN KEY ("tenantId", "ageBracketId") REFERENCES "UnimedAgeBracket"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
