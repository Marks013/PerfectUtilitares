BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- This only provisions an empty store. Legacy team sources remain untouched.
CREATE TABLE "EscalaWorkforce" (
  "tenantId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscalaWorkforce_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "EscalaWorkforce_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EscalaWorkforce_revision" CHECK ("revision" > 0),
  CONSTRAINT "EscalaWorkforce_snapshot" CHECK (
    jsonb_typeof("snapshot") = 'object'
    AND "snapshot" ?& ARRAY['version', 'people', 'catalogs', 'absences']
    AND ("snapshot" - ARRAY['version', 'people', 'catalogs', 'absences']) = '{}'::jsonb
    AND "snapshot"->'version' = '1'::jsonb
    AND jsonb_typeof("snapshot"->'people') = 'array'
    AND jsonb_typeof("snapshot"->'catalogs') = 'array'
    AND jsonb_typeof("snapshot"->'absences') = 'array'
  )
);

COMMIT;
