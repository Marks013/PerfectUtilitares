-- AlterEnum
ALTER TYPE "UnimedImportSource" ADD VALUE 'PAYROLL_LOANS';

-- CreateTable
CREATE TABLE "UnimedImportSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "source" "UnimedImportSource" NOT NULL,
    "checksum" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedImportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedPayrollLoan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "beneficiaryId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "competence" TEXT NOT NULL,
    "cpfNormalized" TEXT,
    "registration" TEXT,
    "employeeName" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "installmentAmount" DECIMAL(14,2) NOT NULL,
    "startCompetence" TEXT NOT NULL,
    "endCompetence" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "totalInstallments" INTEGER,
    "loanAmount" DECIMAL(14,2),
    "releasedAmount" DECIMAL(14,2),
    "contractStartDate" DATE,
    "contractEndDate" DATE,
    "companyCnpj" TEXT,
    "matchMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedPayrollLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnimedImportSnapshot_competencyId_source_key" ON "UnimedImportSnapshot"("competencyId", "source");

-- CreateIndex
CREATE INDEX "UnimedImportSnapshot_tenantId_source_idx" ON "UnimedImportSnapshot"("tenantId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedPayrollLoan_competencyId_sourceKey_key" ON "UnimedPayrollLoan"("competencyId", "sourceKey");

-- CreateIndex
CREATE INDEX "UnimedPayrollLoan_tenantId_competence_cpfNormalized_idx" ON "UnimedPayrollLoan"("tenantId", "competence", "cpfNormalized");

-- CreateIndex
CREATE INDEX "UnimedPayrollLoan_competencyId_registration_idx" ON "UnimedPayrollLoan"("competencyId", "registration");

-- CreateIndex
CREATE INDEX "UnimedPayrollLoan_beneficiaryId_idx" ON "UnimedPayrollLoan"("beneficiaryId");

-- CreateIndex
CREATE INDEX "UnimedPayrollLoan_importBatchId_idx" ON "UnimedPayrollLoan"("importBatchId");

-- AddForeignKey
ALTER TABLE "UnimedImportSnapshot" ADD CONSTRAINT "UnimedImportSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportSnapshot" ADD CONSTRAINT "UnimedImportSnapshot_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "UnimedCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "UnimedCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "UnimedImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPayrollLoan" ADD CONSTRAINT "UnimedPayrollLoan_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "UnimedBeneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant and competency isolation (defense in depth)
CREATE FUNCTION "validate_unimed_import_snapshot_tenant"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."source" NOT IN ('BENEFICIARIES', 'INVOICES', 'ADDRESSES') THEN
    RAISE EXCEPTION 'Snapshot não aceita esta fonte de importação';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "UnimedCompetency"
    WHERE "id" = NEW."competencyId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Snapshot e competência pertencem a empresas diferentes';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_validate_unimed_import_snapshot_tenant"
BEFORE INSERT OR UPDATE ON "UnimedImportSnapshot"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_import_snapshot_tenant"();

CREATE FUNCTION "validate_unimed_payroll_loan_tenant"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "UnimedCompetency"
    WHERE "id" = NEW."competencyId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Consignado e competência pertencem a empresas diferentes';
  END IF;

  IF NEW."importBatchId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedImportBatch"
    WHERE "id" = NEW."importBatchId"
      AND "tenantId" = NEW."tenantId"
      AND "competencyId" = NEW."competencyId"
  ) THEN
    RAISE EXCEPTION 'Consignado e lote pertencem a empresas ou competências diferentes';
  END IF;

  IF NEW."beneficiaryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedBeneficiary"
    WHERE "id" = NEW."beneficiaryId"
      AND "tenantId" = NEW."tenantId"
      AND "competencyId" = NEW."competencyId"
      AND "category" = 'HOLDER'
  ) THEN
    RAISE EXCEPTION 'Consignado deve estar vinculado a um titular da mesma empresa e competência';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_validate_unimed_payroll_loan_tenant"
BEFORE INSERT OR UPDATE ON "UnimedPayrollLoan"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_payroll_loan_tenant"();
