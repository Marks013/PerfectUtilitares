-- Preserve existing jobs and the identity of their original queue delivery.
ALTER TABLE "PdfJob" ADD COLUMN "recoveryAttempt" INTEGER NOT NULL DEFAULT 0;
