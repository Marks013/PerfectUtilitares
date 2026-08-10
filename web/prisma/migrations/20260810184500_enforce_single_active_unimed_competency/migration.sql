DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UnimedCompetency"
    WHERE "status" = 'ACTIVE'
    GROUP BY "tenantId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active Unimed competency: duplicated ACTIVE rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "UnimedCompetency_one_active_per_tenant_idx"
ON "UnimedCompetency"("tenantId")
WHERE "status" = 'ACTIVE';
