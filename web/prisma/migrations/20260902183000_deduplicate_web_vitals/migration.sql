ALTER TABLE "SeoWebVital"
  ADD COLUMN "metricId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "SeoWebVital_metricId_key" ON "SeoWebVital"("metricId");
