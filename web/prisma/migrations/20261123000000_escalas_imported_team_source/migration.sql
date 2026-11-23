BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "EscalaImportedTeam" (
  "tenantId" TEXT NOT NULL,
  "branchCode" TEXT NOT NULL,
  "sourceWorkspaceId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "EscalaImportedTeam_pkey" PRIMARY KEY ("tenantId", "branchCode"),
  CONSTRAINT "EscalaImportedTeam_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EscalaImportedTeam_source" CHECK ("sourceWorkspaceId" <> '' AND "sourceRevision" > 0),
  CONSTRAINT "EscalaImportedTeam_period" CHECK (
    "startDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND "endDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND "startDate"::date <= "endDate"::date
  ),
  CONSTRAINT "EscalaImportedTeam_snapshot" CHECK (jsonb_typeof("snapshot") = 'object')
);

COMMIT;
