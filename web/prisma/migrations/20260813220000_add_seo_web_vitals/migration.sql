CREATE TABLE "SeoWebVital" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "navigationType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoWebVital_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoWebVital_createdAt_idx" ON "SeoWebVital"("createdAt");
CREATE INDEX "SeoWebVital_path_metric_createdAt_idx" ON "SeoWebVital"("path", "metric", "createdAt");
