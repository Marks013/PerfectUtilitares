\set ON_ERROR_STOP on

BEGIN;

SELECT "id" AS tenant_id
FROM "Tenant"
WHERE "slug" = :'tenant_slug'
\gset

DELETE FROM "UnimedPlanPriceVersion"
WHERE "tenantId" = :'tenant_id'
  AND "planCode" IN (
    'PERSONAL PLUS ENFERMARIA PARTICIPATIVO CE',
    'PERSONAL PLUS SEM OBSTETRICIA ENFERMARIA PARTICIPA'
  )
  AND "validFrom" IN (DATE '2024-07-01', DATE '2026-08-01');

INSERT INTO "UnimedAgeBracket" (
  "id", "tenantId", "code", "label", "minAge", "maxAge", "sortOrder",
  "active", "createdAt", "updatedAt"
)
SELECT
  'unimed-age-' || substr(md5(:'tenant_id' || bracket.code), 1, 16),
  :'tenant_id', bracket.code, bracket.label, bracket.min_age,
  bracket.max_age, bracket.sort_order, TRUE, NOW(), NOW()
FROM (
  VALUES
    ('00-18', '0 - 18 anos', 0, 18, 1),
    ('19-23', '19 - 23 anos', 19, 23, 2),
    ('24-28', '24 - 28 anos', 24, 28, 3),
    ('29-33', '29 - 33 anos', 29, 33, 4),
    ('34-38', '34 - 38 anos', 34, 38, 5),
    ('39-43', '39 - 43 anos', 39, 43, 6),
    ('44-48', '44 - 48 anos', 44, 48, 7),
    ('49-53', '49 - 53 anos', 49, 53, 8),
    ('54-58', '54 - 58 anos', 54, 58, 9),
    ('59+', '> 59 anos', 59, NULL, 10)
) AS bracket(code, label, min_age, max_age, sort_order)
ON CONFLICT ("tenantId", "code") DO UPDATE SET
  "label" = EXCLUDED."label",
  "minAge" = EXCLUDED."minAge",
  "maxAge" = EXCLUDED."maxAge",
  "sortOrder" = EXCLUDED."sortOrder",
  "active" = TRUE,
  "updatedAt" = NOW();

WITH plan_codes(code) AS (
  VALUES
    ('1013'),
    ('10041')
), prices(valid_from, valid_to, employee_amount, bracket_code, company_amount) AS (
  VALUES
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '00-18', 102.67),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '19-23', 125.03),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '24-28', 156.59),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '29-33', 180.24),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '34-38', 213.39),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '39-43', 238.81),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '44-48', 274.89),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '49-53', 339.46),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '54-58', 431.18),
    (DATE '2024-07-01', DATE '2026-07-31', 54.21, '59+', 612.96),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '00-18', 116.02),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '19-23', 141.29),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '24-28', 176.95),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '29-33', 203.71),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '34-38', 241.17),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '39-43', 269.89),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '44-48', 310.67),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '49-53', 383.65),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '54-58', 487.31),
    (DATE '2026-08-01', DATE '2027-07-31', 61.26, '59+', 692.76)
)
INSERT INTO "UnimedPlanPriceVersion" (
  "id", "tenantId", "ageBracketId", "planCode", "companyAmount",
  "employeeAmount", "validFrom", "validTo", "createdAt", "updatedAt"
)
SELECT
  'unimed-price-' || substr(md5(
    :'tenant_id' || plan_codes.code || prices.bracket_code || prices.valid_from::text
  ), 1, 16),
  :'tenant_id', bracket."id", plan_codes.code, prices.company_amount,
  prices.employee_amount, prices.valid_from, prices.valid_to, NOW(), NOW()
FROM prices
CROSS JOIN plan_codes
JOIN "UnimedAgeBracket" AS bracket
  ON bracket."tenantId" = :'tenant_id'
 AND bracket."code" = prices.bracket_code
ON CONFLICT ("tenantId", "ageBracketId", "planCode", "validFrom") DO UPDATE SET
  "companyAmount" = EXCLUDED."companyAmount",
  "employeeAmount" = EXCLUDED."employeeAmount",
  "validTo" = EXCLUDED."validTo",
  "updatedAt" = NOW();

INSERT INTO "UnimedAddonPriceVersion" (
  "id", "tenantId", "code", "label", "amount", "validFrom", "validTo",
  "createdAt", "updatedAt"
)
VALUES
  ('unimed-addon-' || substr(md5(:'tenant_id' || 'FUNERAL' || '2024-07-01'), 1, 16),
   :'tenant_id', 'FUNERAL', 'Aditivo funeral', 5.42, DATE '2024-07-01', DATE '2026-07-31', NOW(), NOW()),
  ('unimed-addon-' || substr(md5(:'tenant_id' || 'FUNERAL' || '2026-08-01'), 1, 16),
   :'tenant_id', 'FUNERAL', 'Aditivo funeral', 6.12, DATE '2026-08-01', DATE '2027-07-31', NOW(), NOW())
ON CONFLICT ("tenantId", "code", "validFrom") DO UPDATE SET
  "label" = EXCLUDED."label",
  "amount" = EXCLUDED."amount",
  "validTo" = EXCLUDED."validTo",
  "updatedAt" = NOW();

INSERT INTO "UnimedBillingSetting" (
  "id", "tenantId", "closure", "closingDay", "validFrom", "validTo",
  "createdAt", "updatedAt"
)
VALUES
  ('unimed-billing-' || substr(md5(:'tenant_id' || '2024-07-01'), 1, 16),
   :'tenant_id', 'AUTOMATIC_DAY_25', 25, DATE '2024-07-01', DATE '2026-07-31', NOW(), NOW()),
  ('unimed-billing-' || substr(md5(:'tenant_id' || '2026-08-01'), 1, 16),
   :'tenant_id', 'AUTOMATIC_DAY_25', 25, DATE '2026-08-01', DATE '2027-07-31', NOW(), NOW())
ON CONFLICT ("tenantId", "validFrom") DO UPDATE SET
  "closure" = EXCLUDED."closure",
  "closingDay" = EXCLUDED."closingDay",
  "validTo" = EXCLUDED."validTo",
  "updatedAt" = NOW();

INSERT INTO "UnimedCalculationRuleVersion" (
  "id", "tenantId", "annualAdjustment", "difference", "validFrom", "validTo",
  "createdAt", "updatedAt"
)
VALUES (
  'unimed-rule-' || substr(md5(:'tenant_id' || '2026-08-01'), 1, 16),
  :'tenant_id', 0.1300, 0.0000, DATE '2026-08-01', DATE '2027-07-31', NOW(), NOW()
)
ON CONFLICT ("tenantId", "validFrom") DO UPDATE SET
  "annualAdjustment" = EXCLUDED."annualAdjustment",
  "difference" = EXCLUDED."difference",
  "validTo" = EXCLUDED."validTo",
  "updatedAt" = NOW();

INSERT INTO "UnimedEmailSetting" (
  "id", "tenantId", "recipients", "subjectTemplate", "enabled", "createdAt", "updatedAt"
)
VALUES (
  'unimed-email-' || substr(md5(:'tenant_id'), 1, 16),
  :'tenant_id',
  ARRAY['faturamento@unimednoroestepr.com.br', 'faturamento1@unimedumr.com.br'],
  'Solicitação de Coparticipação', TRUE, NOW(), NOW()
)
ON CONFLICT ("tenantId") DO UPDATE SET
  "recipients" = EXCLUDED."recipients",
  "subjectTemplate" = EXCLUDED."subjectTemplate",
  "enabled" = EXCLUDED."enabled",
  "updatedAt" = NOW();

COMMIT;
