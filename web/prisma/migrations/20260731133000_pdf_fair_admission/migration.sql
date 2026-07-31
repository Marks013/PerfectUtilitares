ALTER TABLE "PdfJob" ADD COLUMN "principalKey" TEXT;

UPDATE "PdfJob"
SET "principalKey" = CASE
  WHEN "userId" IS NOT NULL THEN 'legacy:user:' || "userId"
  WHEN "ownerSessionHash" IS NOT NULL THEN 'legacy:session:' || "ownerSessionHash"
  ELSE 'legacy:migration:' || "id"
END;

ALTER TABLE "PdfJob" ALTER COLUMN "principalKey" SET NOT NULL;

ALTER TABLE "PdfJob"
  ADD CONSTRAINT "PdfJob_principal_key_check"
  CHECK (length("principalKey") >= 16);

CREATE INDEX "PdfJob_principalKey_status_expiresAt_idx"
  ON "PdfJob"("principalKey", "status", "expiresAt");
