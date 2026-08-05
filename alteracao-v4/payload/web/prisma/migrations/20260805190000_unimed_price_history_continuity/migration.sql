-- Mantém cada versão válida até a véspera da próxima, eliminando lacunas históricas.
WITH ordered AS (
  SELECT id,
         LEAD("validFrom") OVER (
           PARTITION BY "tenantId", "ageBracketId", "planCode"
           ORDER BY "validFrom"
         ) AS next_from
  FROM "UnimedPlanPriceVersion"
)
UPDATE "UnimedPlanPriceVersion" AS current
SET "validTo" = (ordered.next_from - INTERVAL '1 day')::date
FROM ordered
WHERE current.id = ordered.id
  AND ordered.next_from IS NOT NULL
  AND (current."validTo" IS NULL OR current."validTo" <> (ordered.next_from - INTERVAL '1 day')::date);

WITH ordered AS (
  SELECT id,
         LEAD("validFrom") OVER (
           PARTITION BY "tenantId", code
           ORDER BY "validFrom"
         ) AS next_from
  FROM "UnimedAddonPriceVersion"
)
UPDATE "UnimedAddonPriceVersion" AS current
SET "validTo" = (ordered.next_from - INTERVAL '1 day')::date
FROM ordered
WHERE current.id = ordered.id
  AND ordered.next_from IS NOT NULL
  AND (current."validTo" IS NULL OR current."validTo" <> (ordered.next_from - INTERVAL '1 day')::date);

WITH ordered AS (
  SELECT id,
         LEAD("validFrom") OVER (
           PARTITION BY "tenantId"
           ORDER BY "validFrom"
         ) AS next_from
  FROM "UnimedBillingSetting"
)
UPDATE "UnimedBillingSetting" AS current
SET "validTo" = (ordered.next_from - INTERVAL '1 day')::date
FROM ordered
WHERE current.id = ordered.id
  AND ordered.next_from IS NOT NULL
  AND (current."validTo" IS NULL OR current."validTo" <> (ordered.next_from - INTERVAL '1 day')::date);

WITH ordered AS (
  SELECT id,
         LEAD("validFrom") OVER (
           PARTITION BY "tenantId"
           ORDER BY "validFrom"
         ) AS next_from
  FROM "UnimedCalculationRuleVersion"
)
UPDATE "UnimedCalculationRuleVersion" AS current
SET "validTo" = (ordered.next_from - INTERVAL '1 day')::date
FROM ordered
WHERE current.id = ordered.id
  AND ordered.next_from IS NOT NULL
  AND (current."validTo" IS NULL OR current."validTo" <> (ordered.next_from - INTERVAL '1 day')::date);
