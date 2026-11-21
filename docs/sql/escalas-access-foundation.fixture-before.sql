-- PREPARED, NOT EXECUTED. Disposable PostgreSQL only, after existing repository migrations.
-- Run with psql ON_ERROR_STOP before the candidate SQL. Never use application/production credentials.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF left(current_database(), length('escalas_access_test_')) <> 'escalas_access_test_' THEN
    RAISE EXCEPTION 'Use a disposable escalas_access_test_ database.';
  END IF;
  IF to_regclass('"EscalaOperator"') IS NOT NULL THEN
    RAISE EXCEPTION 'Candidate already applied; prepare a fresh database to test legacy preservation.';
  END IF;
END
$guard$;

INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES
  ('escala-access-fixture-a', 'Synthetic A', 'escala-access-fixture-a', CURRENT_TIMESTAMP),
  ('escala-access-fixture-b', 'Synthetic B', 'escala-access-fixture-b', CURRENT_TIMESTAMP);
INSERT INTO "EscalaModuleSession" ("id", "tenantId", "tokenHash", "createdAt", "expiresAt") VALUES
  ('escala-access-fixture-legacy', 'escala-access-fixture-a', 'synthetic-legacy-token-hash',
   TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2099-01-01 00:00:00');
COMMIT;
