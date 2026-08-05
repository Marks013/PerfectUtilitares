-- CreateEnum
CREATE TYPE "UnimedAccessLevel" AS ENUM ('ADMIN', 'MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "UnimedCompetencyStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'ACTIVE', 'PREVIOUS', 'REJECTED');

-- CreateEnum
CREATE TYPE "UnimedImportStatus" AS ENUM ('STAGED', 'VALIDATING', 'VALID', 'INVALID', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "UnimedImportSource" AS ENUM ('BENEFICIARIES', 'INVOICES', 'ADDRESSES');

-- CreateEnum
CREATE TYPE "UnimedBeneficiaryCategory" AS ENUM ('HOLDER', 'DEPENDENT');

-- CreateEnum
CREATE TYPE "UnimedBillingClosure" AS ENUM ('OPEN', 'AUTOMATIC_DAY_25');

-- CreateEnum
CREATE TYPE "UnimedDocumentKind" AS ENUM ('RN561', 'INACTIVE_TERM', 'NONE');

-- CreateTable
CREATE TABLE "UnimedUserAccess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "UnimedAccessLevel" NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedUserAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedCompetency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "UnimedCompetencyStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "publishedById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "UnimedImportStatus" NOT NULL DEFAULT 'STAGED',
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "validationSummary" JSONB,
    "finishedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedImportSourceResult" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "source" "UnimedImportSource" NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnimedImportSourceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedBranch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "cnpj" TEXT NOT NULL,
    "addressLine" TEXT,
    "district" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedBeneficiary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "branchId" TEXT,
    "holderId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "registration" TEXT,
    "fullName" TEXT NOT NULL,
    "cpf" TEXT,
    "birthDate" DATE,
    "inclusionDate" DATE,
    "category" "UnimedBeneficiaryCategory" NOT NULL,
    "relationship" TEXT,
    "planCode" TEXT,
    "planName" TEXT,
    "accommodation" TEXT,
    "companyCnpj" TEXT,
    "hasAddon" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedAddress" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "addressLine" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedInvoiceItem" (
    "id" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "branchId" TEXT,
    "beneficiaryId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "holderName" TEXT,
    "category" "UnimedBeneficiaryCategory" NOT NULL,
    "itemCode" TEXT,
    "itemDescription" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "planCode" TEXT,
    "planName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnimedInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedAgeBracket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "maxAge" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedAgeBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedPlanPriceVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ageBracketId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "companyAmount" DECIMAL(14,2) NOT NULL,
    "employeeAmount" DECIMAL(14,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedPlanPriceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedAddonPriceVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedAddonPriceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedBillingSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "closure" "UnimedBillingClosure" NOT NULL,
    "closingDay" INTEGER,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedBillingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedExclusionReason" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "documentKind" "UnimedDocumentKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedExclusionReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedCalculationRuleVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "annualAdjustment" DECIMAL(7,4) NOT NULL,
    "difference" DECIMAL(7,4) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedCalculationRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedEmailSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipients" TEXT[],
    "subjectTemplate" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedEmailSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnimedDocumentTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "UnimedDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedDocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnimedUserAccess_userId_key" ON "UnimedUserAccess"("userId");

-- CreateIndex
CREATE INDEX "UnimedUserAccess_tenantId_active_idx" ON "UnimedUserAccess"("tenantId", "active");

-- CreateIndex
CREATE INDEX "UnimedCompetency_tenantId_status_idx" ON "UnimedCompetency"("tenantId", "status");

-- CreateIndex
CREATE INDEX "UnimedCompetency_tenantId_activatedAt_idx" ON "UnimedCompetency"("tenantId", "activatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedCompetency_tenantId_year_month_key" ON "UnimedCompetency"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "UnimedImportBatch_competencyId_status_idx" ON "UnimedImportBatch"("competencyId", "status");

-- CreateIndex
CREATE INDEX "UnimedImportBatch_requestedById_createdAt_idx" ON "UnimedImportBatch"("requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedImportBatch_tenantId_idempotencyKey_key" ON "UnimedImportBatch"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedImportSourceResult_batchId_source_key" ON "UnimedImportSourceResult"("batchId", "source");

-- CreateIndex
CREATE INDEX "UnimedBranch_tenantId_active_idx" ON "UnimedBranch"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedBranch_tenantId_code_key" ON "UnimedBranch"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedBranch_tenantId_cnpj_key" ON "UnimedBranch"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "UnimedBeneficiary_tenantId_competencyId_fullName_idx" ON "UnimedBeneficiary"("tenantId", "competencyId", "fullName");

-- CreateIndex
CREATE INDEX "UnimedBeneficiary_competencyId_cpf_idx" ON "UnimedBeneficiary"("competencyId", "cpf");

-- CreateIndex
CREATE INDEX "UnimedBeneficiary_competencyId_registration_idx" ON "UnimedBeneficiary"("competencyId", "registration");

-- CreateIndex
CREATE INDEX "UnimedBeneficiary_holderId_idx" ON "UnimedBeneficiary"("holderId");

-- CreateIndex
CREATE INDEX "UnimedBeneficiary_branchId_idx" ON "UnimedBeneficiary"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedBeneficiary_competencyId_sourceKey_key" ON "UnimedBeneficiary"("competencyId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedAddress_beneficiaryId_key" ON "UnimedAddress"("beneficiaryId");

-- CreateIndex
CREATE INDEX "UnimedInvoiceItem_competencyId_beneficiaryName_idx" ON "UnimedInvoiceItem"("competencyId", "beneficiaryName");

-- CreateIndex
CREATE INDEX "UnimedInvoiceItem_competencyId_holderName_idx" ON "UnimedInvoiceItem"("competencyId", "holderName");

-- CreateIndex
CREATE INDEX "UnimedInvoiceItem_beneficiaryId_idx" ON "UnimedInvoiceItem"("beneficiaryId");

-- CreateIndex
CREATE INDEX "UnimedInvoiceItem_branchId_idx" ON "UnimedInvoiceItem"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedInvoiceItem_competencyId_sourceKey_key" ON "UnimedInvoiceItem"("competencyId", "sourceKey");

-- CreateIndex
CREATE INDEX "UnimedAgeBracket_tenantId_active_idx" ON "UnimedAgeBracket"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedAgeBracket_tenantId_code_key" ON "UnimedAgeBracket"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedAgeBracket_tenantId_sortOrder_key" ON "UnimedAgeBracket"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "UnimedPlanPriceVersion_tenantId_planCode_validFrom_validTo_idx" ON "UnimedPlanPriceVersion"("tenantId", "planCode", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedPlanPriceVersion_tenantId_ageBracketId_planCode_valid_key" ON "UnimedPlanPriceVersion"("tenantId", "ageBracketId", "planCode", "validFrom");

-- CreateIndex
CREATE INDEX "UnimedAddonPriceVersion_tenantId_code_validFrom_validTo_idx" ON "UnimedAddonPriceVersion"("tenantId", "code", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedAddonPriceVersion_tenantId_code_validFrom_key" ON "UnimedAddonPriceVersion"("tenantId", "code", "validFrom");

-- CreateIndex
CREATE INDEX "UnimedBillingSetting_tenantId_validFrom_validTo_idx" ON "UnimedBillingSetting"("tenantId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedBillingSetting_tenantId_validFrom_key" ON "UnimedBillingSetting"("tenantId", "validFrom");

-- CreateIndex
CREATE INDEX "UnimedExclusionReason_tenantId_active_idx" ON "UnimedExclusionReason"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedExclusionReason_tenantId_code_key" ON "UnimedExclusionReason"("tenantId", "code");

-- CreateIndex
CREATE INDEX "UnimedCalculationRuleVersion_tenantId_validFrom_validTo_idx" ON "UnimedCalculationRuleVersion"("tenantId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedCalculationRuleVersion_tenantId_validFrom_key" ON "UnimedCalculationRuleVersion"("tenantId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedEmailSetting_tenantId_key" ON "UnimedEmailSetting"("tenantId");

-- CreateIndex
CREATE INDEX "UnimedDocumentTemplate_tenantId_kind_active_idx" ON "UnimedDocumentTemplate"("tenantId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UnimedDocumentTemplate_tenantId_kind_version_key" ON "UnimedDocumentTemplate"("tenantId", "kind", "version");

-- AddForeignKey
ALTER TABLE "UnimedUserAccess" ADD CONSTRAINT "UnimedUserAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedUserAccess" ADD CONSTRAINT "UnimedUserAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedCompetency" ADD CONSTRAINT "UnimedCompetency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportBatch" ADD CONSTRAINT "UnimedImportBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportBatch" ADD CONSTRAINT "UnimedImportBatch_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "UnimedCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportBatch" ADD CONSTRAINT "UnimedImportBatch_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportBatch" ADD CONSTRAINT "UnimedImportBatch_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedImportSourceResult" ADD CONSTRAINT "UnimedImportSourceResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UnimedImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBranch" ADD CONSTRAINT "UnimedBranch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "UnimedCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "UnimedBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBeneficiary" ADD CONSTRAINT "UnimedBeneficiary_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "UnimedBeneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedAddress" ADD CONSTRAINT "UnimedAddress_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "UnimedBeneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "UnimedCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "UnimedBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedInvoiceItem" ADD CONSTRAINT "UnimedInvoiceItem_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "UnimedBeneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedAgeBracket" ADD CONSTRAINT "UnimedAgeBracket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPlanPriceVersion" ADD CONSTRAINT "UnimedPlanPriceVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedPlanPriceVersion" ADD CONSTRAINT "UnimedPlanPriceVersion_ageBracketId_fkey" FOREIGN KEY ("ageBracketId") REFERENCES "UnimedAgeBracket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedAddonPriceVersion" ADD CONSTRAINT "UnimedAddonPriceVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedBillingSetting" ADD CONSTRAINT "UnimedBillingSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedExclusionReason" ADD CONSTRAINT "UnimedExclusionReason_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedCalculationRuleVersion" ADD CONSTRAINT "UnimedCalculationRuleVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedEmailSetting" ADD CONSTRAINT "UnimedEmailSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnimedDocumentTemplate" ADD CONSTRAINT "UnimedDocumentTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma's schema language.
ALTER TABLE "UnimedCompetency"
ADD CONSTRAINT "UnimedCompetency_month_check"
CHECK ("month" BETWEEN 1 AND 12);

CREATE UNIQUE INDEX "UnimedCompetency_one_active_per_tenant"
ON "UnimedCompetency" ("tenantId")
WHERE "status" = 'ACTIVE';

ALTER TABLE "UnimedImportBatch"
ADD CONSTRAINT "UnimedImportBatch_counts_check"
CHECK (
  "sourceCount" >= 0
  AND "rowCount" >= 0
  AND "rejectedCount" >= 0
  AND "warningCount" >= 0
  AND "rejectedCount" <= "rowCount"
);

ALTER TABLE "UnimedAgeBracket"
ADD CONSTRAINT "UnimedAgeBracket_ranges_check"
CHECK (
  "minAge" >= 0
  AND ("maxAge" IS NULL OR "maxAge" >= "minAge")
  AND "sortOrder" >= 0
);

ALTER TABLE "UnimedPlanPriceVersion"
ADD CONSTRAINT "UnimedPlanPriceVersion_values_check"
CHECK (
  "companyAmount" >= 0
  AND "employeeAmount" >= 0
  AND ("validTo" IS NULL OR "validTo" >= "validFrom")
);

ALTER TABLE "UnimedAddonPriceVersion"
ADD CONSTRAINT "UnimedAddonPriceVersion_values_check"
CHECK (
  "amount" >= 0
  AND ("validTo" IS NULL OR "validTo" >= "validFrom")
);

ALTER TABLE "UnimedBillingSetting"
ADD CONSTRAINT "UnimedBillingSetting_values_check"
CHECK (
  ("validTo" IS NULL OR "validTo" >= "validFrom")
  AND (
    ("closure" = 'OPEN' AND "closingDay" IS NULL)
    OR ("closure" = 'AUTOMATIC_DAY_25' AND "closingDay" = 25)
  )
);

ALTER TABLE "UnimedCalculationRuleVersion"
ADD CONSTRAINT "UnimedCalculationRuleVersion_values_check"
CHECK (
  "annualAdjustment" >= 0
  AND "difference" >= 0
  AND ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "UnimedPlanPriceVersion"
ADD CONSTRAINT "UnimedPlanPriceVersion_no_overlap"
EXCLUDE USING gist (
  "tenantId" WITH =,
  "ageBracketId" WITH =,
  "planCode" WITH =,
  tsrange(
    "validFrom",
    COALESCE("validTo", 'infinity'::timestamp),
    '[]'
  ) WITH &&
);

ALTER TABLE "UnimedAddonPriceVersion"
ADD CONSTRAINT "UnimedAddonPriceVersion_no_overlap"
EXCLUDE USING gist (
  "tenantId" WITH =,
  "code" WITH =,
  tsrange(
    "validFrom",
    COALESCE("validTo", 'infinity'::timestamp),
    '[]'
  ) WITH &&
);

ALTER TABLE "UnimedBillingSetting"
ADD CONSTRAINT "UnimedBillingSetting_no_overlap"
EXCLUDE USING gist (
  "tenantId" WITH =,
  tsrange(
    "validFrom",
    COALESCE("validTo", 'infinity'::timestamp),
    '[]'
  ) WITH &&
);

ALTER TABLE "UnimedCalculationRuleVersion"
ADD CONSTRAINT "UnimedCalculationRuleVersion_no_overlap"
EXCLUDE USING gist (
  "tenantId" WITH =,
  tsrange(
    "validFrom",
    COALESCE("validTo", 'infinity'::timestamp),
    '[]'
  ) WITH &&
);

-- Defesa adicional de isolamento multi-tenant. As relações simples do Prisma
-- continuam disponíveis, mas o PostgreSQL rejeita vínculos entre empresas.
CREATE FUNCTION "validate_unimed_user_access_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."userId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'UnimedUserAccess pertence a empresa diferente do usuário'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UnimedUserAccess_tenant_guard"
BEFORE INSERT OR UPDATE ON "UnimedUserAccess"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_user_access_tenant"();

CREATE FUNCTION "validate_unimed_import_batch_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "UnimedCompetency"
    WHERE "id" = NEW."competencyId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Competência Unimed pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."requestedById" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Solicitante da importação pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."publishedById" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."publishedById" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Publicador da importação pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UnimedImportBatch_tenant_guard"
BEFORE INSERT OR UPDATE ON "UnimedImportBatch"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_import_batch_tenant"();

CREATE FUNCTION "validate_unimed_beneficiary_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "UnimedCompetency"
    WHERE "id" = NEW."competencyId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Beneficiário e competência pertencem a empresas diferentes'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."branchId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedBranch"
    WHERE "id" = NEW."branchId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Beneficiário e filial pertencem a empresas diferentes'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."holderId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedBeneficiary"
    WHERE "id" = NEW."holderId"
      AND "tenantId" = NEW."tenantId"
      AND "competencyId" = NEW."competencyId"
  ) THEN
    RAISE EXCEPTION 'Dependente e titular pertencem a competências diferentes'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UnimedBeneficiary_tenant_guard"
BEFORE INSERT OR UPDATE ON "UnimedBeneficiary"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_beneficiary_tenant"();

CREATE FUNCTION "validate_unimed_invoice_item_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competency_tenant text;
BEGIN
  SELECT "tenantId" INTO competency_tenant
  FROM "UnimedCompetency"
  WHERE "id" = NEW."competencyId";

  IF competency_tenant IS NULL THEN
    RAISE EXCEPTION 'Competência da fatura não existe'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."branchId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedBranch"
    WHERE "id" = NEW."branchId" AND "tenantId" = competency_tenant
  ) THEN
    RAISE EXCEPTION 'Item de fatura e filial pertencem a empresas diferentes'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."beneficiaryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnimedBeneficiary"
    WHERE "id" = NEW."beneficiaryId"
      AND "competencyId" = NEW."competencyId"
  ) THEN
    RAISE EXCEPTION 'Item de fatura e beneficiário pertencem a competências diferentes'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UnimedInvoiceItem_tenant_guard"
BEFORE INSERT OR UPDATE ON "UnimedInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_invoice_item_tenant"();

CREATE FUNCTION "validate_unimed_plan_price_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "UnimedAgeBracket"
    WHERE "id" = NEW."ageBracketId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Preço e faixa etária pertencem a empresas diferentes'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UnimedPlanPriceVersion_tenant_guard"
BEFORE INSERT OR UPDATE ON "UnimedPlanPriceVersion"
FOR EACH ROW EXECUTE FUNCTION "validate_unimed_plan_price_tenant"();
