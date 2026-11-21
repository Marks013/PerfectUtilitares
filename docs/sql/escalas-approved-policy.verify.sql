-- PREPARED, NOT EXECUTED. Requires reviewed candidate DDL in an existing isolated test DB.
-- Run with psql ON_ERROR_STOP=1. Never production; no environment is created by this script.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF left(current_database(), length('escalas_access_test_')) <> 'escalas_access_test_' THEN
    RAISE EXCEPTION 'Refusing database outside escalas_access_test_ prefix';
  END IF;
END;
$$;

DO $$
DECLARE
  v_snapshot jsonb;
  v_count integer;
  v_constraint text;
BEGIN
  INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES
    ('policy-test-a', 'Synthetic A', 'policy-test-a', CURRENT_TIMESTAMP),
    ('policy-test-b', 'Synthetic B', 'policy-test-b', CURRENT_TIMESTAMP);
  INSERT INTO "User" ("id", "tenantId", "email", "name", "passwordHash", "role", "updatedAt") VALUES
    ('policy-admin-a', 'policy-test-a', 'policy-a@example.invalid', 'Synthetic admin A', 'TEST_ONLY_NON_LOGIN', 'ADMIN', CURRENT_TIMESTAMP),
    ('policy-admin-b', 'policy-test-b', 'policy-b@example.invalid', 'Synthetic admin B', 'TEST_ONLY_NON_LOGIN', 'ADMIN', CURRENT_TIMESTAMP);

  -- SQL envelope fixture only. Full EscalaInput and SHA-256 correctness are proved in TS,
  -- and MUST be revalidated by the future service; this fake hash is not an approval.
  v_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'configuration', jsonb_build_object('branchCode', '02', 'startDate', '2026-11-30',
      'endDate', '2027-01-03', 'visibleMonth', '2026-12'),
    'seed', jsonb_build_object('employees', jsonb_build_array(jsonb_build_object('id', 'synthetic')),
      'shifts', '[]'::jsonb, 'assignments', '[]'::jsonb),
    'regimeModels', jsonb_build_array(jsonb_build_object('id', 'synthetic-model')),
    'provenance', jsonb_build_object('tenantId', 'policy-test-a', 'approvedById', 'policy-admin-a',
      'approvedAt', '2026-11-13T12:00:00.000Z', 'origin', NULL));

  -- Approval can exist before the workspace. No branch registry or workspace is fabricated.
  INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate",
    "visibleMonth", "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
  VALUES ('policy-test-v1', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
    1, 1, v_snapshot, repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00');

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" SELECT 'policy-test-duplicate', "tenantId", "branchCode", "startDate", "endDate",
      "visibleMonth", "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt",
      "originWorkspaceId", "originRevision", "revokedAt"
      FROM "EscalaBranchPolicyVersion" WHERE "id" = 'policy-test-v1';
    RAISE EXCEPTION 'Expected branch-period-version uniqueness rejection';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-invalid-version', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
      0, 1, v_snapshot, repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected positive version check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-invalid-branch', 'policy-test-a', '002', '2026-11-30', '2027-01-03', '2026-12',
      2, 1, jsonb_set(v_snapshot, '{configuration,branchCode}', '"002"'), repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected canonical branch check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-invalid-hash', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
      2, 1, v_snapshot, 'client-supplied', 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected hash format check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-invalid-period', 'policy-test-a', '02', '2026-11-30', '2026-12-31', '2026-12',
      2, 1, jsonb_set(v_snapshot, '{configuration,endDate}', '"2026-12-31"'), repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected whole-week period check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-invalid-snapshot', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
      2, 1, v_snapshot || '{"unexpected":true}'::jsonb, repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected closed snapshot envelope check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt", "originWorkspaceId")
    VALUES ('policy-test-partial-origin', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
      2, 1, v_snapshot, repeat('a', 64), 'policy-admin-a', '2026-11-13 12:00:00', 'missing');
    RAISE EXCEPTION 'Expected all-or-none origin check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
      "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-foreign-admin', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12',
      2, 1, jsonb_set(v_snapshot, '{provenance,approvedById}', '"policy-admin-b"'), repeat('a', 64), 'policy-admin-b', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected tenant approver FK check';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO "EscalaWorkspace" ("id", "tenantId", "branchCode", "branchName", "startDate", "endDate", "updatedAt") VALUES
    ('policy-work-a', 'policy-test-a', '02', 'Synthetic A', '2026-11-30', '2027-01-03', CURRENT_TIMESTAMP),
    ('policy-work-b', 'policy-test-b', '02', 'Synthetic B', '2026-11-30', '2027-01-03', CURRENT_TIMESTAMP);
  -- A complete Sunday period is accepted only when its immutable snapshot declares it.
  INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate",
    "visibleMonth", "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
  VALUES ('policy-test-sunday', 'policy-test-a', '02', '2026-11-29', '2027-01-02', '2026-12',
    1, 1, jsonb_set(v_snapshot, '{configuration}', (v_snapshot->'configuration') ||
      '{"startDate":"2026-11-29","endDate":"2027-01-02","planningWeekStartsOn":"SUNDAY"}'),
    repeat('d', 64), 'policy-admin-a', '2026-11-13 12:00:00');
  BEGIN
    INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate",
      "visibleMonth", "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt")
    VALUES ('policy-test-undeclared-sunday', 'policy-test-a', '02', '2026-11-29', '2027-01-02', '2026-12',
      2, 1, jsonb_set(v_snapshot, '{configuration}', (v_snapshot->'configuration') ||
        '{"startDate":"2026-11-29","endDate":"2027-01-02"}'),
      repeat('e', 64), 'policy-admin-a', '2026-11-13 12:00:00');
    RAISE EXCEPTION 'Expected Sunday period without a declared calendar to be rejected';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS DISTINCT FROM 'EscalaPolicy_period' THEN RAISE; END IF;
  END;

  -- Legacy all-null reference remains allowed. No backfill is inferred.
  INSERT INTO "EscalaRevision" ("id", "tenantId", "workspaceId", "revision", "status", "input") VALUES
    ('policy-legacy', 'policy-test-a', 'policy-work-a', 1, 'DRAFT', '{}'::jsonb);
  SELECT count(*) INTO v_count FROM "EscalaRevision" WHERE "id" = 'policy-legacy' AND "approvedPolicyVersionId" IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Legacy reference changed'; END IF;
  INSERT INTO "EscalaRevision" ("id", "tenantId", "workspaceId", "revision", "status", "input", "approvedPolicyVersionId") VALUES
    ('policy-bound', 'policy-test-a', 'policy-work-a', 2, 'DRAFT', '{}'::jsonb, 'policy-test-v1');

  BEGIN
    INSERT INTO "EscalaRevision" ("id", "tenantId", "workspaceId", "revision", "status", "input", "approvedPolicyVersionId") VALUES
      ('policy-cross-tenant', 'policy-test-b', 'policy-work-b', 1, 'DRAFT', '{}'::jsonb, 'policy-test-v1');
    RAISE EXCEPTION 'Expected tenant policy FK check';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    UPDATE "EscalaBranchPolicyVersion" SET "snapshotHash" = repeat('b', 64) WHERE "id" = 'policy-test-v1';
    RAISE EXCEPTION 'Expected immutable content rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE "EscalaBranchPolicyVersion" SET "revokedAt" = '2026-11-14 12:00:00' WHERE "id" = 'policy-test-v1';
  BEGIN
    UPDATE "EscalaBranchPolicyVersion" SET "revokedAt" = NULL WHERE "id" = 'policy-test-v1';
    RAISE EXCEPTION 'Expected revocation rollback rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM "EscalaBranchPolicyVersion" WHERE "id" = 'policy-test-v1';
    RAISE EXCEPTION 'Expected historical deletion rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM "User" WHERE "id" = 'policy-admin-a';
    RAISE EXCEPTION 'Expected approver history Restrict rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- Correction appends a distinct version; revocation did not change the immutable snapshot/hash.
  INSERT INTO "EscalaBranchPolicyVersion" ("id", "tenantId", "branchCode", "startDate", "endDate", "visibleMonth",
    "version", "snapshotSchemaVersion", "snapshot", "snapshotHash", "approvedById", "approvedAt", "originWorkspaceId", "originRevision")
  VALUES ('policy-test-v2', 'policy-test-a', '02', '2026-11-30', '2027-01-03', '2026-12', 2, 1,
    jsonb_set(v_snapshot, '{provenance,origin}', '{"workspaceId":"policy-work-a","revision":1}'),
    repeat('c', 64), 'policy-admin-a', '2026-11-13 12:00:00', 'policy-work-a', 1);
  BEGIN
    DELETE FROM "EscalaRevision" WHERE "id" = 'policy-legacy';
    RAISE EXCEPTION 'Expected source revision Restrict rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
