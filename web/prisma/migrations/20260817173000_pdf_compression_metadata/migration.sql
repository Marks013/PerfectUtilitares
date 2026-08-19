-- Resultado real da compressão por artefato.
ALTER TABLE "PdfArtifact" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
