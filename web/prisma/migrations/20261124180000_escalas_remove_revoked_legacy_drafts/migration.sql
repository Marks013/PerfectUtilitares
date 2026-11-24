BEGIN;

-- Keep approval snapshots immutable. Allow physical deletion only in the
-- replaced December transition case; foreign keys still protect consumers.
CREATE OR REPLACE FUNCTION "escala_approved_policy_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."revokedAt" IS NULL OR OLD."originWorkspaceId" IS NULL
      OR OLD."startDate" <> '2026-11-30' OR OLD."endDate" <> '2027-01-03'
      OR NOT EXISTS (
        SELECT 1 FROM "EscalaWorkspace" old_plan
        JOIN "EscalaWorkspace" replacement
          ON replacement."tenantId" = old_plan."tenantId"
          AND replacement."branchCode" = old_plan."branchCode"
          AND replacement."startDate" = '2026-12-01' AND replacement."endDate" = '2026-12-31'
        WHERE old_plan."tenantId" = OLD."tenantId" AND old_plan."id" = OLD."originWorkspaceId"
          AND old_plan."status" = 'DRAFT' AND old_plan."branchCode" = OLD."branchCode"
          AND old_plan."startDate" = OLD."startDate" AND old_plan."endDate" = OLD."endDate"
      )
      OR EXISTS (
        SELECT 1 FROM "EscalaRevision" r WHERE r."tenantId" = OLD."tenantId"
          AND (r."workspaceId" = OLD."originWorkspaceId" AND r."status" = 'PUBLISHED'
            OR r."workspaceId" <> OLD."originWorkspaceId" AND r."input"#>>'{planningCalendarSource,workspaceId}' = OLD."originWorkspaceId")
      )
      OR EXISTS (
        SELECT 1 FROM "EscalaBranchPolicyVersion" p WHERE p."tenantId" = OLD."tenantId"
          AND p."branchCode" = OLD."branchCode" AND p."startDate" = OLD."startDate" AND p."endDate" = OLD."endDate"
          AND p."revokedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "EscalaImportedTeam" t WHERE t."tenantId" = OLD."tenantId"
          AND t."sourceWorkspaceId" = OLD."originWorkspaceId"
      )
      OR EXISTS (
        SELECT 1 FROM "EscalaSolveOperation" s WHERE s."tenantId" = OLD."tenantId"
          AND s."workspaceId" = OLD."originWorkspaceId" AND s."state" IN ('CREATED', 'RUNNING', 'CANCEL_REQUESTED')
          AND s."expiresAt" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      ) THEN
      RAISE EXCEPTION 'Approved policy history cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt')
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
    RAISE EXCEPTION 'Approved policy content is immutable; create another version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
