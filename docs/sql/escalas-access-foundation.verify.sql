-- PREPARED, NOT EXECUTED. Run after fixture-before and candidate, with psql ON_ERROR_STOP.
-- Assertions use synthetic records only. All records created by this verification roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF left(current_database(), length('escalas_access_test_')) <> 'escalas_access_test_' THEN
    RAISE EXCEPTION 'Use a disposable escalas_access_test_ database.';
  END IF;
  IF (SELECT count(*) FROM "EscalaModuleSession" WHERE "id" = 'escala-access-fixture-legacy'
    AND "tenantId" = 'escala-access-fixture-a' AND "tokenHash" = 'synthetic-legacy-token-hash'
    AND "createdAt" = TIMESTAMP '2026-01-01 00:00:00' AND "expiresAt" = TIMESTAMP '2099-01-01 00:00:00'
    AND "revokedAt" IS NULL AND "operatorId" IS NULL AND "permissionVersion" IS NULL AND "accessPolicyVersion" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Legacy session was not preserved exactly.';
  END IF;
  IF EXISTS (SELECT 1 FROM "EscalaOperator") OR EXISTS (SELECT 1 FROM "EscalaOperatorBranchGrant")
    OR EXISTS (SELECT 1 FROM "EscalaModuleAccessPolicy") THEN
    RAISE EXCEPTION 'Candidate unexpectedly created access records, or database is not isolated.';
  END IF;
END
$guard$;

CREATE FUNCTION pg_temp.expect_access_failure(statement TEXT, expected_state TEXT) RETURNS VOID
LANGUAGE plpgsql AS $function$
DECLARE actual_state TEXT;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, got %', expected_state, actual_state;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %, but statement succeeded', expected_state;
END
$function$;

-- Same normalized username is valid across different tenants; duplicate within one tenant is not.
INSERT INTO "EscalaOperator" ("id", "tenantId", "usernameNormalized", "displayName", "updatedAt") VALUES
  ('escala-access-op-a', 'escala-access-fixture-a', 'joão', 'Synthetic A', CURRENT_TIMESTAMP),
  ('escala-access-op-b', 'escala-access-fixture-b', 'joão', 'Synthetic B', CURRENT_TIMESTAMP);
SELECT pg_temp.expect_access_failure($sql$
  INSERT INTO "EscalaOperator" ("id", "tenantId", "usernameNormalized", "displayName", "updatedAt")
  VALUES ('duplicate-name', 'escala-access-fixture-a', 'joão', 'Duplicate', CURRENT_TIMESTAMP)
$sql$, '23505');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperator" SET "permissionVersion" = 0 WHERE "id" = 'escala-access-op-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperator" SET "usernameNormalized" = ' ' WHERE "id" = 'escala-access-op-a'
$sql$, '23514');

INSERT INTO "EscalaModuleAccessPolicy" ("tenantId", "updatedAt")
VALUES ('escala-access-fixture-a', CURRENT_TIMESTAMP);
INSERT INTO "EscalaOperatorBranchGrant" ("id", "tenantId", "operatorId", "branchCode", "updatedAt")
VALUES ('escala-access-grant-a', 'escala-access-fixture-a', 'escala-access-op-a', '01', CURRENT_TIMESTAMP);
DO $defaults$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EscalaOperator" WHERE "id" = 'escala-access-op-a' AND NOT "active" AND "permissionVersion" = 1)
    OR NOT EXISTS (SELECT 1 FROM "EscalaOperatorBranchGrant" WHERE "id" = 'escala-access-grant-a' AND NOT "active" AND cardinality("capabilities") = 0)
    OR NOT EXISTS (SELECT 1 FROM "EscalaModuleAccessPolicy" WHERE "tenantId" = 'escala-access-fixture-a' AND "mode" = 'ADMIN_ONLY' AND "version" = 1) THEN
    RAISE EXCEPTION 'Access defaults are not closed.';
  END IF;
END
$defaults$;

SELECT pg_temp.expect_access_failure($sql$
  INSERT INTO "EscalaOperatorBranchGrant" ("id", "tenantId", "operatorId", "branchCode", "updatedAt")
  VALUES ('cross-tenant-grant', 'escala-access-fixture-b', 'escala-access-op-a', '01', CURRENT_TIMESTAMP)
$sql$, '23503');
SELECT pg_temp.expect_access_failure($sql$
  INSERT INTO "EscalaOperatorBranchGrant" ("id", "tenantId", "operatorId", "branchCode", "updatedAt")
  VALUES ('duplicate-grant', 'escala-access-fixture-a', 'escala-access-op-a', '01', CURRENT_TIMESTAMP)
$sql$, '23505');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "branchCode" = '001' WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "branchCode" = '' WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = NULL WHERE "id" = 'escala-access-grant-a'
$sql$, '23502');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = ARRAY['import.manage'] WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = ARRAY['future.action'] WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = ARRAY[NULL]::TEXT[] WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = ARRAY[['workspace.read'], ['workspace.save']] WHERE "id" = 'escala-access-grant-a'
$sql$, '23514');
UPDATE "EscalaOperatorBranchGrant" SET "capabilities" = ARRAY['workspace.read', 'export.schedule.pdf']
WHERE "id" = 'escala-access-grant-a';

SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaModuleAccessPolicy" SET "mode" = 'UNKNOWN' WHERE "tenantId" = 'escala-access-fixture-a'
$sql$, '23514');
SELECT pg_temp.expect_access_failure($sql$
  UPDATE "EscalaModuleAccessPolicy" SET "version" = 0 WHERE "tenantId" = 'escala-access-fixture-a'
$sql$, '23514');

-- Every partial combination must fail, not pass as SQL UNKNOWN.
DO $bindings$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('escala-access-op-a'::TEXT, NULL::INTEGER, NULL::INTEGER),
    ('escala-access-op-a', 1, NULL), ('escala-access-op-a', NULL, 1),
    (NULL, 1, NULL), (NULL, NULL, 1), (NULL, 1, 1),
    ('escala-access-op-a', 0, 1), ('escala-access-op-a', 1, -1)
  ) AS cases(operator_id, permission_version, policy_version) LOOP
    PERFORM pg_temp.expect_access_failure(format(
      'INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "expiresAt", "operatorId", "permissionVersion", "accessPolicyVersion") VALUES (''invalid-binding'', ''escala-access-fixture-a'', ''synthetic-invalid-binding'', TIMESTAMP ''2099-01-01'', %L, %L::INTEGER, %L::INTEGER)',
      item.operator_id, item.permission_version, item.policy_version), '23514');
  END LOOP;
END
$bindings$;

SELECT pg_temp.expect_access_failure($sql$
  INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "expiresAt", "operatorId", "permissionVersion", "accessPolicyVersion")
  VALUES ('cross-tenant-session', 'escala-access-fixture-b', 'synthetic-cross-tenant', TIMESTAMP '2099-01-01', 'escala-access-op-a', 1, 1)
$sql$, '23503');
INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "expiresAt", "operatorId", "permissionVersion", "accessPolicyVersion")
VALUES ('escala-access-bound', 'escala-access-fixture-a', 'synthetic-bound-token', TIMESTAMP '2099-01-01', 'escala-access-op-a', 1, 1);

-- Version increments invalidate runtime authorization without rewriting/deleting historical sessions.
UPDATE "EscalaOperator" SET "permissionVersion" = 2 WHERE "id" = 'escala-access-op-a';
UPDATE "EscalaModuleAccessPolicy" SET "version" = 2 WHERE "tenantId" = 'escala-access-fixture-a';
DO $versions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EscalaModuleSession" WHERE "id" = 'escala-access-bound' AND "permissionVersion" = 1 AND "accessPolicyVersion" = 1) THEN
    RAISE EXCEPTION 'Version change rewrote or removed the old session.';
  END IF;
END
$versions$;
SELECT pg_temp.expect_access_failure($sql$
  DELETE FROM "EscalaOperator" WHERE "id" = 'escala-access-op-a'
$sql$, '23503');

-- Each kind of reference must independently prevent direct operator deletion.
INSERT INTO "EscalaOperator" ("id", "tenantId", "usernameNormalized", "displayName", "updatedAt") VALUES
  ('escala-access-grant-only', 'escala-access-fixture-a', 'grant-only', 'Grant only', CURRENT_TIMESTAMP),
  ('escala-access-session-only', 'escala-access-fixture-a', 'session-only', 'Session only', CURRENT_TIMESTAMP);
INSERT INTO "EscalaOperatorBranchGrant" ("id", "tenantId", "operatorId", "branchCode", "updatedAt")
VALUES ('grant-only-link', 'escala-access-fixture-a', 'escala-access-grant-only', '01', CURRENT_TIMESTAMP);
INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "expiresAt", "operatorId", "permissionVersion", "accessPolicyVersion")
VALUES ('session-only-link', 'escala-access-fixture-a', 'synthetic-session-only', TIMESTAMP '2099-01-01', 'escala-access-session-only', 1, 1);
SELECT pg_temp.expect_access_failure($sql$
  DELETE FROM "EscalaOperator" WHERE "id" = 'escala-access-grant-only'
$sql$, '23503');
SELECT pg_temp.expect_access_failure($sql$
  DELETE FROM "EscalaOperator" WHERE "id" = 'escala-access-session-only'
$sql$, '23503');

-- Promotion criterion: preserve existing whole-tenant cascade semantics with no orphaned access rows.
-- This interaction with RESTRICT is UNVERIFIED. A failure blocks promotion and requires FK review.
INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
VALUES ('escala-access-fixture-c', 'Synthetic cascade', 'escala-access-fixture-c', CURRENT_TIMESTAMP);
INSERT INTO "EscalaOperator" ("id", "tenantId", "usernameNormalized", "displayName", "updatedAt")
VALUES ('escala-access-cascade-op', 'escala-access-fixture-c', 'cascade', 'Cascade', CURRENT_TIMESTAMP);
INSERT INTO "EscalaOperatorBranchGrant" ("id", "tenantId", "operatorId", "branchCode", "updatedAt")
VALUES ('cascade-grant', 'escala-access-fixture-c', 'escala-access-cascade-op', '01', CURRENT_TIMESTAMP);
INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "expiresAt", "operatorId", "permissionVersion", "accessPolicyVersion")
VALUES ('cascade-session', 'escala-access-fixture-c', 'synthetic-cascade', TIMESTAMP '2099-01-01', 'escala-access-cascade-op', 1, 1);
DELETE FROM "Tenant" WHERE "id" = 'escala-access-fixture-c';
DO $cascade$
BEGIN
  IF EXISTS (SELECT 1 FROM "EscalaOperator" WHERE "tenantId" = 'escala-access-fixture-c')
    OR EXISTS (SELECT 1 FROM "EscalaOperatorBranchGrant" WHERE "tenantId" = 'escala-access-fixture-c')
    OR EXISTS (SELECT 1 FROM "EscalaModuleSession" WHERE "tenantId" = 'escala-access-fixture-c') THEN
    RAISE EXCEPTION 'Whole-tenant deletion left orphaned access rows.';
  END IF;
END
$cascade$;

ROLLBACK;
