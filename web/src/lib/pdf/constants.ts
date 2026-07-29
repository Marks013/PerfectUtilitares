export const MAX_PDF_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_JOB_BYTES = 500 * 1024 * 1024;
export const MAX_PDF_JOB_FILES = 20;
export const PDF_JOB_RETENTION_MINUTES = 30;

export function getPdfJobExpiry(now = new Date()) {
  return new Date(now.getTime() + PDF_JOB_RETENTION_MINUTES * 60 * 1_000);
}
