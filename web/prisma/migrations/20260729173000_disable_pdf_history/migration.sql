-- PDF jobs are operational and no longer queried as user history.
DROP INDEX IF EXISTS "PdfJob_tenantId_createdAt_idx";
DROP INDEX IF EXISTS "PdfJob_userId_createdAt_idx";
DROP INDEX IF EXISTS "PdfJob_status_createdAt_idx";
