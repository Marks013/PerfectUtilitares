import { z } from "zod";
import { isDate } from "./dates";
import type { EscalaAssignment, EscalaWorkspace } from "./types";

const maxFileBytes = 512 * 1024;
export const isImportSyncFileSizeAllowed = (bytes: number) => bytes > 0 && bytes <= maxFileBytes;

const id = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u);
const date = z.string().refine(isDate, "Informe uma data real no formato AAAA-MM-DD.");
const common = {
  purpose: z.enum(["EMPLOYEES", "ABSENCES"]), workspaceId: id,
  expectedRevision: z.coerce.number().int().min(1).max(2_000_000_000),
  startDate: date, endDate: date,
};
export const importSyncCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...common, action: z.literal("PREVIEW_REPLACE"), completeScopeConfirmed: z.boolean().default(false) }),
  z.strictObject({ ...common, action: z.literal("APPLY_REPLACE"), completeScopeConfirmed: z.literal(true), confirm: z.literal(true),
    expectedImpactHash: z.string().regex(/^[a-f0-9]{64}$/) }),
]).refine(value => value.startDate <= value.endDate && Date.parse(value.endDate) - Date.parse(value.startDate) <= 41 * 86_400_000,
  "Confira o intervalo de até 42 dias.");
export type ImportSyncCommand = z.infer<typeof importSyncCommandSchema>;
export type ImportSyncPurpose = ImportSyncCommand["purpose"];
export type ImportSyncPreviewCommand = Extract<ImportSyncCommand, { action: "PREVIEW_REPLACE" }>;
export const importSyncLayoutSchema = z.enum(["ESCALA_TEMPLATE", "FPRE136", "FPHI105", "UNRECOGNIZED"]);
type ImportSyncLayout = z.infer<typeof importSyncLayoutSchema>;

export const IMPORT_SYNC_BLOCKER_CODES = ["COVERAGE_UNCONFIRMED", "SCOPE_MISMATCH", "SOURCE_INVALID", "EMPTY_SOURCE",
  "SOURCE_PERIOD", "AMBIGUOUS_REGISTRATION", "DUPLICATE_REGISTRATION", "PROTECTED_ASSIGNMENT", "MANUAL_REFERENCE_CONFLICT",
  "ID_CONFLICT", "INVALID_CANDIDATE", "APPROVAL_UNAVAILABLE", "TOO_MANY_PEOPLE", "OUTSIDE_BINDING", "SOURCE_IDENTITY", "SOURCE_PARTIAL"] as const;
type ImportSyncBlockerCode = typeof IMPORT_SYNC_BLOCKER_CODES[number];
export type ImportSyncProblem = { code: ImportSyncBlockerCode; message: string; line?: number; employeeId?: string; date?: string };
type ImportSyncWarning = { code: "SOURCE_WARNING" | "NUMERIC_REGISTRATION_MATCH" | "UNKNOWN_BINDING" | "OUTSIDE_SCOPE";
  message: string; line?: number; employeeId?: string };
export type ImportSyncPersonChange = { id: string; registration: string; name: string; fields: string[] };
type ImportSyncAbsenceDay = { employeeId: string; registration: string; date: string };
type ImportSyncAssignmentChange = { employeeId: string; registration: string; date: string;
  previousKind: EscalaAssignment["kind"] | null; nextKind: EscalaAssignment["kind"] | null;
  previousShiftId: string | null; nextShiftId: string | null };
type ImportSyncReferenceChange = { employeeId: string; registration: string; before: string; after: string };
type ImportSyncImpact = {
  people: { added: ImportSyncPersonChange[]; updated: ImportSyncPersonChange[]; removed: ImportSyncPersonChange[]; unchanged: ImportSyncPersonChange[] };
  absences: { added: ImportSyncAbsenceDay[]; removed: ImportSyncAbsenceDay[]; unchanged: ImportSyncAbsenceDay[] };
  assignments: ImportSyncAssignmentChange[];
  references: ImportSyncReferenceChange[];
};
export type ImportSyncPreview = {
  contractVersion: 1; purpose: ImportSyncPurpose; layout: ImportSyncLayout;
  context: { workspaceId: string; revision: number; branchCode: string; workspaceStartDate: string; workspaceEndDate: string;
    visibleMonth: string | null; status: "DRAFT" | "PUBLISHED" };
  scope: { startDate: string; endDate: string };
  coverage: { completeScopeConfirmed: boolean; sourcePeriod: { startDate: string; endDate: string } | null;
    basis: "ADMIN_DECLARATION" | "REPORT_PERIOD_AND_ADMIN_DECLARATION" };
  fileHash: string; expectedImpactHash: string; canApply: boolean;
  impact: ImportSyncImpact; blockers: ImportSyncProblem[]; warnings: ImportSyncWarning[];
  counts: { addedPeople: number; updatedPeople: number; removedPeople: number; unchangedPeople: number;
    addedAbsenceDays: number; removedAbsenceDays: number; unchangedAbsenceDays: number; assignmentChanges: number; blockers: number };
  effect: { nextStatus: "DRAFT"; needsRegeneration: boolean; approvalInvalidated: boolean;
    approvedPolicyVersionIdBefore: string | null; approvedPolicyVersionIdAfter: string | null };
};
export type ImportSyncPreviewResult = { preview: ImportSyncPreview };
export type ImportSyncApplyResult = { workspace: EscalaWorkspace; summary: ImportSyncPreview };
