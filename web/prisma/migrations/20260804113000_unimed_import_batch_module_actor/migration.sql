CREATE OR REPLACE FUNCTION "validate_unimed_import_batch_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "UnimedCompetency"
    WHERE "id" = NEW."competencyId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Competência Unimed pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."requestedById" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."requestedById" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Solicitante da importação pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."publishedById" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."publishedById" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Publicador da importação pertence a outra empresa'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
