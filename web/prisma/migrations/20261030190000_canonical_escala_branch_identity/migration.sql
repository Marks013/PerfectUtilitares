-- Preserve all workspace/revision IDs and all grants. Never merge conflicting identities implicitly.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE "EscalaWorkspace", "EscalaBranchAccess" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION "escala_canonical_branch_code"(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  -- Match String.trim's whitespace without numeric casts, rounding or truncation.
  WITH trimmed AS (
    SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') AS code
  ), significant AS (
    SELECT code, coalesce(nullif(ltrim(code, '0'), ''), '0') AS digits FROM trimmed
  )
  SELECT CASE WHEN code ~ '^[0-9]+$'
    THEN CASE WHEN length(digits) < 2 THEN lpad(digits, 2, '0') ELSE digits END
    ELSE code END FROM significant
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EscalaWorkspace" WHERE length("escala_canonical_branch_code"("branchCode")) = 0)
    OR EXISTS (SELECT 1 FROM "EscalaBranchAccess" WHERE length("escala_canonical_branch_code"("branchCode")) = 0) THEN
    RAISE EXCEPTION 'Escala branch migration aborted: blank branch identity requires explicit review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "EscalaWorkspace"
    GROUP BY "tenantId", "escala_canonical_branch_code"("branchCode"), "startDate", "endDate"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Escala branch migration aborted: equivalent workspace codes share a period; preserve revisions and resolve identities explicitly.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "EscalaBranchAccess"
    GROUP BY "tenantId", "userId", "escala_canonical_branch_code"("branchCode")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Escala branch migration aborted: equivalent grants require explicit permission review; no roles were merged.';
  END IF;
END
$$;

UPDATE "EscalaWorkspace"
SET "branchCode" = "escala_canonical_branch_code"("branchCode")
WHERE "branchCode" IS DISTINCT FROM "escala_canonical_branch_code"("branchCode");
UPDATE "EscalaBranchAccess"
SET "branchCode" = "escala_canonical_branch_code"("branchCode")
WHERE "branchCode" IS DISTINCT FROM "escala_canonical_branch_code"("branchCode");

-- Existing unique indexes now protect the canonical identity against concurrent alias creation.
ALTER TABLE "EscalaWorkspace" ADD CONSTRAINT "EscalaWorkspace_branchCode_canonical_check"
  CHECK (length("branchCode") > 0 AND "branchCode" = "escala_canonical_branch_code"("branchCode"));
ALTER TABLE "EscalaBranchAccess" ADD CONSTRAINT "EscalaBranchAccess_branchCode_canonical_check"
  CHECK (length("branchCode") > 0 AND "branchCode" = "escala_canonical_branch_code"("branchCode"));
COMMIT;
