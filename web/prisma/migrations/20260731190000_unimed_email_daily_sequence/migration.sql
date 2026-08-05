CREATE TABLE "UnimedEmailDailySequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnimedEmailDailySequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnimedEmailDailySequence_tenantId_day_key"
ON "UnimedEmailDailySequence"("tenantId", "day");

CREATE INDEX "UnimedEmailDailySequence_tenantId_day_idx"
ON "UnimedEmailDailySequence"("tenantId", "day");

ALTER TABLE "UnimedEmailDailySequence"
ADD CONSTRAINT "UnimedEmailDailySequence_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
