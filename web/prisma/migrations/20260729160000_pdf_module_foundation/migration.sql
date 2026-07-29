-- CreateEnum
CREATE TYPE "PdfJobStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PdfOperation" AS ENUM ('COMPRESS', 'MERGE', 'SPLIT', 'ROTATE', 'DELETE_PAGES', 'EXTRACT_PAGES', 'ORGANIZE', 'EDIT', 'ANNOTATE', 'CROP', 'PDF_TO_JPG', 'JPG_TO_PDF', 'PDF_TO_WORD', 'PDF_TO_EXCEL', 'WORD_TO_PDF', 'EXCEL_TO_PDF');

-- CreateEnum
CREATE TYPE "PdfArtifactKind" AS ENUM ('INPUT', 'OUTPUT', 'PREVIEW');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "canAccessPdf" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "UserInvitation" ADD COLUMN "canAccessPdf" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PdfJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "operation" "PdfOperation" NOT NULL,
    "status" "PdfJobStatus" NOT NULL DEFAULT 'DRAFT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "inputBytes" BIGINT NOT NULL DEFAULT 0,
    "outputBytes" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfArtifact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "PdfArtifactKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdfArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfJob_tenantId_createdAt_idx" ON "PdfJob"("tenantId", "createdAt");
CREATE INDEX "PdfJob_userId_createdAt_idx" ON "PdfJob"("userId", "createdAt");
CREATE INDEX "PdfJob_status_createdAt_idx" ON "PdfJob"("status", "createdAt");
CREATE INDEX "PdfJob_expiresAt_idx" ON "PdfJob"("expiresAt");
CREATE UNIQUE INDEX "PdfArtifact_storageKey_key" ON "PdfArtifact"("storageKey");
CREATE INDEX "PdfArtifact_jobId_kind_idx" ON "PdfArtifact"("jobId", "kind");

-- AddForeignKey
ALTER TABLE "PdfJob" ADD CONSTRAINT "PdfJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PdfJob" ADD CONSTRAINT "PdfJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PdfArtifact" ADD CONSTRAINT "PdfArtifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PdfJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
