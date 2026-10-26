#!/usr/bin/env bash
# Exercises the additive migration in a rollback-only schema, never on public tables.
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
{
  cat <<'SQL'
BEGIN;
CREATE SCHEMA escalas_migration_audit;
SET LOCAL search_path = escalas_migration_audit, pg_catalog;
CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "tenantId" TEXT);
SQL
  cat prisma/migrations/20261026160000_add_escala_workspaces/migration.sql
  cat <<'SQL'
INSERT INTO "Tenant" VALUES ('a'), ('b');
INSERT INTO "User" VALUES ('user-a', 'a');
INSERT INTO "EscalaWorkspace" ("id","tenantId","branchCode","branchName","startDate","endDate","updatedAt")
VALUES ('workspace-a','a','01','Teste A','2026-11-02','2026-11-08',now()),
('workspace-b','b','01','Teste B','2026-11-02','2026-11-08',now());
INSERT INTO "EscalaBranchAccess" ("id","tenantId","userId","branchCode","role","updatedAt")
VALUES ('grant-a','a','user-a','01','PLANNER',now());
INSERT INTO "EscalaRevision" ("id","tenantId","workspaceId","revision","status","input","createdById")
VALUES ('revision-a','a','workspace-a',1,'DRAFT','{}','user-a');
DO $$
BEGIN
  BEGIN
    INSERT INTO "EscalaRevision" ("id","tenantId","workspaceId","revision","status","input","createdById")
    VALUES ('cross-company','a','workspace-b',1,'DRAFT','{}','user-a');
    RAISE EXCEPTION 'cross-company revision accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "EscalaBranchAccess" ("id","tenantId","userId","branchCode","role","updatedAt")
    VALUES ('cross-grant','b','user-a','01','APPROVER',now());
    RAISE EXCEPTION 'cross-company grant accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "EscalaRevision" ("id","tenantId","workspaceId","revision","status","input","createdById")
    VALUES ('duplicate-revision','a','workspace-a',1,'DRAFT','{}','user-a');
    RAISE EXCEPTION 'duplicate revision accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
UPDATE "User" SET "tenantId"='b' WHERE "id"='user-a';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EscalaBranchAccess" WHERE "userId"='user-a') THEN
    RAISE EXCEPTION 'branch permissions survived tenant transfer';
  END IF;
  IF (SELECT count(*) FROM "EscalaRevision") <> 1 THEN
    RAISE EXCEPTION 'historical revision was changed';
  END IF;
END $$;
SELECT 'ESCALAS_MIGRATION_AUDIT_OK';
ROLLBACK;
SQL
} | docker compose exec -T db sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
