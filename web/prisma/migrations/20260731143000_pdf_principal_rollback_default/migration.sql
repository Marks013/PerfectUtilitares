ALTER TABLE "PdfJob"
  ALTER COLUMN "principalKey"
  SET DEFAULT ('legacy:rollback:'::text || (gen_random_uuid())::text);
