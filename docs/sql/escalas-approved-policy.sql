-- OFFLINE CANDIDATE ONLY. Outside prisma/migrations; NOT executed.
-- Requires existing EscalaWorkspace/EscalaRevision and tenant-scoped User unique key.
-- No seed/backfill, generated client, grants, branch master or automatic approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
