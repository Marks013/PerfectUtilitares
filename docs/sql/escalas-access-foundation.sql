-- OFFLINE CANDIDATE. Do not place in prisma/migrations or apply to a shared database yet.
-- Base: c10602c246f3ec7a5f4bf64ae805cddf3cb960ce. No backfill, grants, seed or access activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- BEGIN PRISMA SCHEMA DIFF
-- AlterTable
ALTER TABLE "EscalaModuleSession" ADD COLUMN     "accessPolicyVersion" INTEGER,
ADD COLUMN     "operatorId" TEXT,
ADD COLUMN     "permissionVersion" INTEGER;

-- CreateTable
CREATE TABLE "EscalaOperator" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "usernameNormalized" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalaOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalaOperatorBranchGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalaOperatorBranchGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalaModuleAccessPolicy" (
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ADMIN_ONLY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalaModuleAccessPolicy_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "EscalaOperator_tenantId_active_idx" ON "EscalaOperator"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaOperator_tenantId_id_key" ON "EscalaOperator"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaOperator_tenantId_usernameNormalized_key" ON "EscalaOperator"("tenantId", "usernameNormalized");

-- CreateIndex
CREATE INDEX "EscalaOperatorBranchGrant_tenantId_branchCode_idx" ON "EscalaOperatorBranchGrant"("tenantId", "branchCode");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaOperatorGrant_tenant_operator_branch_key" ON "EscalaOperatorBranchGrant"("tenantId", "operatorId", "branchCode");

-- CreateIndex
CREATE INDEX "EscalaModuleSession_operator_access_idx" ON "EscalaModuleSession"("tenantId", "operatorId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "EscalaOperator" ADD CONSTRAINT "EscalaOperator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalaOperatorBranchGrant" ADD CONSTRAINT "EscalaOperatorBranchGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalaOperatorBranchGrant" ADD CONSTRAINT "EscalaOperatorBranchGrant_tenantId_operatorId_fkey" FOREIGN KEY ("tenantId", "operatorId") REFERENCES "EscalaOperator"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalaModuleAccessPolicy" ADD CONSTRAINT "EscalaModuleAccessPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalaModuleSession" ADD CONSTRAINT "EscalaModuleSession_tenantId_operatorId_fkey" FOREIGN KEY ("tenantId", "operatorId") REFERENCES "EscalaOperator"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- END PRISMA SCHEMA DIFF

-- Manual constraints: Prisma does not express these domain checks in the datamodel.
ALTER TABLE "EscalaOperator" ADD CONSTRAINT "EscalaOperator_version_check"
  CHECK ("permissionVersion" > 0);
ALTER TABLE "EscalaOperator" ADD CONSTRAINT "EscalaOperator_names_check"
  CHECK (length(btrim("usernameNormalized")) > 0 AND length(btrim("displayName")) > 0);

ALTER TABLE "EscalaOperatorBranchGrant" ALTER COLUMN "capabilities" SET NOT NULL;
ALTER TABLE "EscalaOperatorBranchGrant" ADD CONSTRAINT "EscalaOperatorGrant_branch_canonical_check"
  CHECK (length("branchCode") > 0 AND "branchCode" = "escala_canonical_branch_code"("branchCode"));
ALTER TABLE "EscalaOperatorBranchGrant" ADD CONSTRAINT "EscalaOperatorGrant_capabilities_check"
  CHECK (CASE
    WHEN cardinality("capabilities") = 0 THEN true
    WHEN array_ndims("capabilities") = 1 THEN
      array_position("capabilities", NULL) IS NULL
      AND "capabilities" <@ ARRAY[
        'workspace.read', 'workspace.create', 'workspace.save', 'schedule.generate', 'schedule.apply',
        'employee.manage', 'shift.manage', 'export.schedule.pdf', 'export.schedule.xlsx'
      ]::TEXT[]
    ELSE false
  END);

ALTER TABLE "EscalaModuleAccessPolicy" ADD CONSTRAINT "EscalaModuleAccessPolicy_state_check"
  CHECK ("mode" IN ('LEGACY', 'ADMIN_ONLY', 'SCOPED') AND "version" > 0);

-- SQL CHECK accepts UNKNOWN, so the bound branch must assert every non-null field explicitly.
ALTER TABLE "EscalaModuleSession" ADD CONSTRAINT "EscalaModuleSession_operator_binding_check"
  CHECK (
    ("operatorId" IS NULL AND "permissionVersion" IS NULL AND "accessPolicyVersion" IS NULL)
    OR (
      "operatorId" IS NOT NULL AND length(btrim("operatorId")) > 0
      AND "permissionVersion" IS NOT NULL AND "permissionVersion" > 0
      AND "accessPolicyVersion" IS NOT NULL AND "accessPolicyVersion" > 0
    )
  );

COMMIT;
