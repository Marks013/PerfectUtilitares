ALTER TABLE "UnimedBranch"
  ADD COLUMN "number" TEXT,
  ADD COLUMN "stateRegistration" TEXT,
  ADD COLUMN "phone" TEXT;

ALTER TABLE "UnimedBeneficiary"
  ADD COLUMN "rg" TEXT;
