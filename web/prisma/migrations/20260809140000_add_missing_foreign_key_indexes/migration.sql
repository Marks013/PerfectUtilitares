-- Keep foreign-key maintenance and parent-row deletes efficient as tables grow.
CREATE INDEX "UserInvitation_invitedById_idx"
ON "UserInvitation"("invitedById");

CREATE INDEX "PdfJob_tenantId_idx" ON "PdfJob"("tenantId");

CREATE INDEX "UnimedImportBatch_publishedById_idx"
ON "UnimedImportBatch"("publishedById");
