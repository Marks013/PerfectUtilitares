ALTER TABLE "UserInvitation"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'INVITATION',
  ADD COLUMN "resetUserId" TEXT,
  ADD COLUMN "resetStamp" TEXT;

-- Legacy links have no trustworthy purpose or account-state binding.
UPDATE "UserInvitation" SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP)
WHERE "acceptedAt" IS NULL;

ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_purpose_check"
CHECK (
  ("purpose" = 'INVITATION' AND "resetUserId" IS NULL AND "resetStamp" IS NULL)
  OR ("purpose" = 'PASSWORD_RESET' AND "resetUserId" IS NOT NULL AND "resetStamp" IS NOT NULL)
);
