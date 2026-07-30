CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'BANNED');
CREATE TYPE "UsageModule" AS ENUM ('JORNADA', 'FOTOS', 'PDF');

ALTER TABLE "User"
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "User"
  SET "status" = CASE
    WHEN "isActive" THEN 'ACTIVE'::"UserStatus"
    ELSE 'BLOCKED'::"UserStatus"
  END;

ALTER TABLE "User"
  DROP COLUMN "isActive",
  DROP COLUMN "canAccessJornada",
  DROP COLUMN "canAccessFotos",
  DROP COLUMN "canAccessPdf";

ALTER TABLE "UserInvitation"
  DROP COLUMN "canAccessJornada",
  DROP COLUMN "canAccessFotos",
  DROP COLUMN "canAccessPdf";

ALTER TABLE "PdfJob"
  ALTER COLUMN "tenantId" DROP NOT NULL,
  ADD COLUMN "ownerSessionHash" TEXT;

-- Mantém trabalhos transitórios antigos rastreáveis para a rotina de expiração
-- também remover seus arquivos físicos.
UPDATE "PdfJob"
  SET "ownerSessionHash" = 'migration:' || "id"
  WHERE "userId" IS NULL;

ALTER TABLE "PdfJob"
  DROP CONSTRAINT "PdfJob_userId_fkey";

ALTER TABLE "PdfJob"
  ADD CONSTRAINT "PdfJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PdfJob"
  ADD CONSTRAINT "PdfJob_owner_check"
  CHECK (
    ("userId" IS NOT NULL AND "ownerSessionHash" IS NULL)
    OR
    ("userId" IS NULL AND "ownerSessionHash" IS NOT NULL)
  );

CREATE INDEX "PdfJob_ownerSessionHash_status_expiresAt_idx"
  ON "PdfJob"("ownerSessionHash", "status", "expiresAt");

CREATE INDEX "PdfJob_userId_status_expiresAt_idx"
  ON "PdfJob"("userId", "status", "expiresAt");

CREATE TABLE "ApiRateLimitBucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApiRateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ApiRateLimitBucket_resetAt_idx"
  ON "ApiRateLimitBucket"("resetAt");

CREATE TABLE "UserUsageDaily" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "module" "UsageModule" NOT NULL,
  "operation" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "inputBytes" BIGINT NOT NULL DEFAULT 0,
  "outputBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserUsageDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserUsageDaily_userId_date_module_operation_key"
  ON "UserUsageDaily"("userId", "date", "module", "operation");

CREATE INDEX "UserUsageDaily_date_idx"
  ON "UserUsageDaily"("date");

CREATE INDEX "UserUsageDaily_userId_date_idx"
  ON "UserUsageDaily"("userId", "date");

ALTER TABLE "UserUsageDaily"
  ADD CONSTRAINT "UserUsageDaily_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
