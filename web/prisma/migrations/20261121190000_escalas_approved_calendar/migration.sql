BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Older immutable snapshots omit the week start and keep Monday through Sunday.
-- New Sunday snapshots must declare the calendar that was reviewed.
ALTER TABLE "EscalaBranchPolicyVersion"
  DROP CONSTRAINT "EscalaPolicy_period",
  ADD CONSTRAINT "EscalaPolicy_period" CHECK (
    "startDate" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    AND "endDate" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    AND "startDate"::date <= "endDate"::date
    AND "endDate"::date - "startDate"::date BETWEEN 6 AND 41
    AND CASE
      WHEN NOT (("snapshot"->'configuration') ? 'planningWeekStartsOn')
        OR "snapshot"#>>'{configuration,planningWeekStartsOn}' = 'MONDAY'
        THEN extract(isodow FROM "startDate"::date) = 1 AND extract(isodow FROM "endDate"::date) = 7
      WHEN "snapshot"#>>'{configuration,planningWeekStartsOn}' = 'SUNDAY'
        THEN extract(isodow FROM "startDate"::date) = 7 AND extract(isodow FROM "endDate"::date) = 6
      ELSE false
    END
    AND ("visibleMonth" IS NULL OR (
      "visibleMonth" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      AND ("visibleMonth" || '-01')::date >= "startDate"::date
      AND (("visibleMonth" || '-01')::date + interval '1 month - 1 day')::date <= "endDate"::date)));

COMMIT;
