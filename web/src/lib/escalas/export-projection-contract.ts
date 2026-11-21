import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";

/** Change whenever projection rules or the meaning of a cache identity change. */
export const ESCALA_EXPORT_PROJECTION_CONTRACT_VERSION = 1;
const identifier = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u);
const visible = (value: string) => !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(value);
const metadataSchema = z.strictObject({
  tenantId: identifier,
  workspaceId: identifier,
  branchCode: z.string().max(640).refine(visible).transform(canonicalBranchCode).pipe(z.string().min(1).max(160)),
  revision: z.number().int().min(1).max(2_000_000_000),
  format: z.enum(["pdf", "xlsx"]),
  mode: z.enum(["rest", "hours", "both"]),
  projection: z.enum(["BASIC_SCHEDULE", "ADMIN_FULL"]),
  contentVersion: z.string().min(1).max(128).refine(value => visible(value) && value.trim() === value),
  // Current product decision: keep sector/role/time/name ordering without separate sector sections.
  separateSectors: z.literal(false),
});

/**
 * Candidate content/cache contract, NOT an authorization result or a request-body parser.
 * Supply canonical saved-workspace metadata and the server-resolved projection only AFTER
 * current access, revision and scenario checks. Recheck access on every hit and delivery.
 * Renderers must consume these restrictions; a key alone cannot sanitize existing report bytes.
 */
export function createEscalaExportDescriptor(metadata: unknown) {
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) return null;
  const value = parsed.data;
  const contractVersion = ESCALA_EXPORT_PROJECTION_CONTRACT_VERSION;
  const sections: readonly ("rest" | "hours")[] = Object.freeze(value.mode === "both" ? ["rest", "hours"] : [value.mode]);
  return Object.freeze({
    ...value,
    contractVersion,
    sections,
    // XLSX never includes capacity/shortage analyses, including the administrative projection.
    // This is permission to include supported PDF analyses, not proof that their data exists.
    mayIncludeAnalytics: value.projection === "ADMIN_FULL" && value.format === "pdf",
    cacheKey: JSON.stringify([
      "escala-export-scoped", contractVersion, value.contentVersion, value.tenantId,
      value.workspaceId, value.branchCode, value.revision, value.mode, value.format,
      value.projection, value.separateSectors,
    ]),
  });
}
