-- Scoped Escalas access and approved policy; additive versioned migration.
-- Historical candidates preserved under docs/sql. No seed, backfill or user changes.
-- One transaction covers both schema diffs and all domain constraints/triggers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Source: docs/sql/escalas-access-foundation.sql
-- SHA-256: 3ea81e4403a1f401d9c16cbc8b553bc579f125cdb4ffe36ed751fb96ceccf41e
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

-- Source: docs/sql/escalas-approved-policy.sql
-- SHA-256: 3222ee3badf5c4d88a8997d909be76b29b957817e96d2ee2380bbff081b67235
-- BEGIN PRISMA SCHEMA DIFF
-- AlterTable
ALTER TABLE "EscalaRevision" ADD COLUMN     "approvedPolicyVersionId" TEXT;

-- CreateTable
CREATE TABLE "EscalaBranchPolicyVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "visibleMonth" TEXT,
    "version" INTEGER NOT NULL,
    "snapshotSchemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" VARCHAR(64) NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "originWorkspaceId" TEXT,
    "originRevision" INTEGER,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EscalaBranchPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalaBranchPolicyVersion_tenantId_id_key" ON "EscalaBranchPolicyVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaPolicy_tenant_branch_period_version_key" ON "EscalaBranchPolicyVersion"("tenantId", "branchCode", "startDate", "endDate", "version");

-- CreateIndex
CREATE INDEX "EscalaRevision_approved_policy_idx" ON "EscalaRevision"("tenantId", "approvedPolicyVersionId");

-- AddForeignKey
ALTER TABLE "EscalaRevision" ADD CONSTRAINT "EscalaRevision_tenantId_approvedPolicyVersionId_fkey" FOREIGN KEY ("tenantId", "approvedPolicyVersionId") REFERENCES "EscalaBranchPolicyVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EscalaBranchPolicyVersion" ADD CONSTRAINT "EscalaBranchPolicyVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EscalaBranchPolicyVersion" ADD CONSTRAINT "EscalaBranchPolicyVersion_tenantId_approvedById_fkey" FOREIGN KEY ("tenantId", "approvedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EscalaBranchPolicyVersion" ADD CONSTRAINT "EscalaBranchPolicyVersion_tenantId_originWorkspaceId_origi_fkey" FOREIGN KEY ("tenantId", "originWorkspaceId", "originRevision") REFERENCES "EscalaRevision"("tenantId", "workspaceId", "revision") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- END PRISMA SCHEMA DIFF

-- Checks/triggers below must accompany any future migration; Prisma cannot express them.
ALTER TABLE "EscalaBranchPolicyVersion"
  ADD CONSTRAINT "EscalaPolicy_positive_versions" CHECK (
    "version" > 0 AND "snapshotSchemaVersion" = 1),
  ADD CONSTRAINT "EscalaPolicy_identity" CHECK (
    length("id") BETWEEN 1 AND 100 AND length("tenantId") BETWEEN 1 AND 100
    AND length("approvedById") BETWEEN 1 AND 100),
  ADD CONSTRAINT "EscalaPolicy_canonical_branch" CHECK (
    length("branchCode") BETWEEN 1 AND 160 AND "branchCode" = btrim("branchCode")
    AND "branchCode" !~ '[[:cntrl:]]'
    AND ("branchCode" !~ '^[0-9]+$' OR "branchCode" =
      CASE WHEN length(coalesce(nullif(ltrim("branchCode", '0'), ''), '0')) < 2
        THEN lpad(coalesce(nullif(ltrim("branchCode", '0'), ''), '0'), 2, '0')
        ELSE ltrim("branchCode", '0') END)),
  ADD CONSTRAINT "EscalaPolicy_period" CHECK (
    "startDate" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    AND "endDate" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    AND "startDate"::date <= "endDate"::date
    AND "endDate"::date - "startDate"::date BETWEEN 6 AND 41
    AND extract(isodow FROM "startDate"::date) = 1
    AND extract(isodow FROM "endDate"::date) = 7
    AND ("visibleMonth" IS NULL OR (
      "visibleMonth" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      AND ("visibleMonth" || '-01')::date >= "startDate"::date
      AND (("visibleMonth" || '-01')::date + interval '1 month - 1 day')::date <= "endDate"::date))),
  ADD CONSTRAINT "EscalaPolicy_origin_all_or_none" CHECK (
    ("originWorkspaceId" IS NULL AND "originRevision" IS NULL)
    OR ("originWorkspaceId" IS NOT NULL AND length("originWorkspaceId") BETWEEN 1 AND 100
      AND "originRevision" IS NOT NULL AND "originRevision" > 0)),
  ADD CONSTRAINT "EscalaPolicy_hash" CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "EscalaPolicy_revocation" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "approvedAt"),
  ADD CONSTRAINT "EscalaPolicy_snapshot_format" CHECK (coalesce(
    jsonb_typeof("snapshot") = 'object'
    AND "snapshot" ?& ARRAY['schemaVersion', 'configuration', 'seed', 'regimeModels', 'provenance']
    AND ("snapshot" - ARRAY['schemaVersion', 'configuration', 'seed', 'regimeModels', 'provenance']) = '{}'::jsonb
    AND "snapshot"->'schemaVersion' = to_jsonb("snapshotSchemaVersion")
    AND jsonb_typeof("snapshot"->'configuration') = 'object'
    AND jsonb_typeof("snapshot"->'seed') = 'object'
    AND ("snapshot"->'seed') ?& ARRAY['employees', 'shifts', 'assignments']
    AND (("snapshot"->'seed') - ARRAY['employees', 'shifts', 'assignments']) = '{}'::jsonb
    AND jsonb_typeof("snapshot"#>'{seed,employees}') = 'array'
    AND jsonb_array_length("snapshot"#>'{seed,employees}') BETWEEN 1 AND 250
    AND jsonb_typeof("snapshot"#>'{seed,shifts}') = 'array'
    AND jsonb_array_length("snapshot"#>'{seed,shifts}') <= 120
    AND jsonb_typeof("snapshot"#>'{seed,assignments}') = 'array'
    AND jsonb_array_length("snapshot"#>'{seed,assignments}') <= 10500
    AND jsonb_typeof("snapshot"->'regimeModels') = 'array'
    AND jsonb_array_length("snapshot"->'regimeModels') BETWEEN 1 AND 250
    AND jsonb_typeof("snapshot"->'provenance') = 'object'
    AND ("snapshot"->'provenance') ?& ARRAY['tenantId', 'approvedById', 'approvedAt', 'origin']
    AND (("snapshot"->'provenance') - ARRAY['tenantId', 'approvedById', 'approvedAt', 'origin']) = '{}'::jsonb
    AND "snapshot"#>>'{configuration,branchCode}' = "branchCode"
    AND "snapshot"#>>'{configuration,startDate}' = "startDate"
    AND "snapshot"#>>'{configuration,endDate}' = "endDate"
    AND ("snapshot"#>>'{configuration,visibleMonth}') IS NOT DISTINCT FROM "visibleMonth"
    AND "snapshot"#>>'{provenance,tenantId}' = "tenantId"
    AND "snapshot"#>>'{provenance,approvedById}' = "approvedById"
    AND "snapshot"#>>'{provenance,approvedAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND ("snapshot"#>>'{provenance,approvedAt}')::timestamptz AT TIME ZONE 'UTC' = "approvedAt"
    AND (CASE WHEN "originWorkspaceId" IS NULL THEN "snapshot"#>'{provenance,origin}' = 'null'::jsonb
      ELSE "snapshot"#>'{provenance,origin}' = jsonb_build_object('workspaceId', "originWorkspaceId", 'revision', "originRevision") END), false));

-- Defense in depth: full schema/assignment references/hash recomputation remain server responsibilities.
CREATE FUNCTION "escala_approved_policy_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approved policy history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt')
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
    RAISE EXCEPTION 'Approved policy content is immutable; create another version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "EscalaPolicy_immutable_content"
  BEFORE UPDATE OR DELETE ON "EscalaBranchPolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION "escala_approved_policy_immutable"();

COMMIT;
