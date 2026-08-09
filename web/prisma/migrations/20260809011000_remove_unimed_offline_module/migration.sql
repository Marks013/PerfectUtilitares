-- Remove the rejected Unimed offline feature while preserving migration history.
DROP TABLE IF EXISTS "UnimedOfflineDevice";

DROP INDEX IF EXISTS "PdfJob_tenantId_requestKey_key";

ALTER TABLE "PdfJob"
DROP COLUMN IF EXISTS "requestKey";
