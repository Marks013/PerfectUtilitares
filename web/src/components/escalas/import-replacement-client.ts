import { z } from "zod";
import { importSyncCommandSchema, importSyncLayoutSchema, IMPORT_SYNC_BLOCKER_CODES, isImportSyncFileSizeAllowed, type ImportSyncCommand, type ImportSyncPreview, type ImportSyncApplyResult, type ImportSyncPreviewResult } from "@/lib/escalas/import-sync-contracts";
import { isDate } from "@/lib/escalas/dates";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { parseSavedWorkspace } from "./draft-persistence";

const text = z.string(), date = text.refine(isDate), count = z.number().int().nonnegative();
const person = z.object({ id: text.min(1), registration: text, name: text, fields: z.array(text) });
const day = z.object({ employeeId: text.min(1), registration: text, date });
const kind = z.enum(["WORK", "DUTY", "OFF", "ABSENCE", "HOLIDAY"]);
const previewSchema = z.object({
  contractVersion: z.literal(1), purpose: z.enum(["EMPLOYEES", "ABSENCES"]), layout: importSyncLayoutSchema,
  context: z.object({ workspaceId: text, revision: count, branchCode: text, workspaceStartDate: date, workspaceEndDate: date, visibleMonth: text.nullable(), status: z.enum(["DRAFT", "PUBLISHED"]) }),
  scope: z.object({ startDate: date, endDate: date }),
  coverage: z.object({ completeScopeConfirmed: z.boolean(), sourcePeriod: z.object({ startDate: date, endDate: date }).nullable(), basis: z.enum(["ADMIN_DECLARATION", "REPORT_PERIOD_AND_ADMIN_DECLARATION"]) }),
  fileHash: text.regex(/^[a-f0-9]{64}$/), expectedImpactHash: text.regex(/^[a-f0-9]{64}$/), canApply: z.boolean(),
  impact: z.object({ people: z.object({ added: z.array(person), updated: z.array(person), removed: z.array(person), unchanged: z.array(person) }),
    absences: z.object({ added: z.array(day), removed: z.array(day), unchanged: z.array(day) }),
    assignments: z.array(day.extend({ previousKind: kind.nullable(), nextKind: kind.nullable(), previousShiftId: text.nullable(), nextShiftId: text.nullable() })),
    references: z.array(z.object({ employeeId: text, registration: text, before: text, after: text })) }),
  blockers: z.array(z.object({ code: z.enum(IMPORT_SYNC_BLOCKER_CODES), message: text, line: count.optional(), employeeId: text.optional(), date: date.optional() })),
  warnings: z.array(z.object({ code: z.enum(["SOURCE_WARNING", "NUMERIC_REGISTRATION_MATCH", "UNKNOWN_BINDING", "OUTSIDE_SCOPE"]), message: text, line: count.optional(), employeeId: text.optional() })),
  missingRegistrations: z.array(z.object({ line: count.positive(), name: text.min(1).max(160), sector: text.max(120), role: text.max(120), resolved: z.boolean() })).max(250).optional(),
  counts: z.object({ addedPeople: count, updatedPeople: count, removedPeople: count, unchangedPeople: count, addedAbsenceDays: count, removedAbsenceDays: count, unchangedAbsenceDays: count, assignmentChanges: count, blockers: count }),
  effect: z.object({ nextStatus: z.literal("DRAFT"), needsRegeneration: z.boolean(), approvalInvalidated: z.boolean(), approvedPolicyVersionIdBefore: text.nullable(), approvedPolicyVersionIdAfter: text.nullable(), noChanges: z.literal(true).optional() }),
});
export type ImportReplacementResult = ImportSyncPreviewResult | ImportSyncApplyResult;
export type ReplaceImport = (file: File, command: ImportSyncCommand, signal: AbortSignal) => Promise<ImportReplacementResult | null>;
export const IMPORT_REPLACEMENT_TIMEOUT = 60_000;
export const importReplacementFileSizeMessage = "Selecione um arquivo não vazio de até 512 KB.";
const invalid = () => new Error("A resposta não corresponde à conferência desta filial. Confira o arquivo novamente.");

export function validateImportPreview(value: unknown, command: ImportSyncCommand, workspace: EscalaWorkspace): ImportSyncPreview {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const p = parsed.data;
  if (p.purpose !== command.purpose || p.context.workspaceId !== command.workspaceId || p.context.revision !== command.expectedRevision
    || p.context.branchCode !== workspace.input.branchCode || p.context.workspaceStartDate !== workspace.input.startDate || p.context.workspaceEndDate !== workspace.input.endDate
    || p.context.visibleMonth !== (workspace.input.visibleMonth ?? null) || p.context.status !== workspace.status
    || p.scope.startDate !== command.startDate || p.scope.endDate !== command.endDate || p.coverage.completeScopeConfirmed !== command.completeScopeConfirmed) throw invalid();
  const i = p.impact, n = p.counts;
  const corrections = new Set(command.registrationCorrections?.map(({ line }) => line));
  const missing = p.missingRegistrations ?? [];
  const unresolved = missing.some(row => !row.resolved);
  const people = new Map((workspace.input.employees ?? []).map(person => [person.id, person.registration]));
  const preservedAbsences = new Set((workspace.input.assignments ?? []).filter(day => day.kind === "ABSENCE").map(day => JSON.stringify([day.employeeId, day.date])));
  if (n.addedPeople !== i.people.added.length || n.updatedPeople !== i.people.updated.length || n.removedPeople !== i.people.removed.length || n.unchangedPeople !== i.people.unchanged.length
    || n.addedAbsenceDays !== i.absences.added.length || n.removedAbsenceDays !== i.absences.removed.length || n.unchangedAbsenceDays !== i.absences.unchanged.length || n.assignmentChanges !== i.assignments.length || n.blockers !== p.blockers.length
    || command.startDate < workspace.input.startDate || command.endDate > workspace.input.endDate
    || command.purpose === "EMPLOYEES" && (command.startDate !== workspace.input.startDate || command.endDate !== workspace.input.endDate)
    || command.purpose === "ABSENCES" && (i.people.added.length + i.people.updated.length + i.people.removed.length > 0 || i.references.length > 0)
    || missing.length > 0 && (p.purpose !== "EMPLOYEES" || !["FPRE136", "ESCALA_TEMPLATE"].includes(p.layout))
    || new Set(missing.map(({ line }) => line)).size !== missing.length
    || missing.some(row => row.resolved && !corrections.has(row.line))
    || unresolved && n.removedPeople > 0
    || (p.canApply || p.effect.noChanges) && (unresolved || corrections.size !== missing.length)
    || p.effect.noChanges && (p.purpose !== "EMPLOYEES" || p.canApply || p.layout === "UNRECOGNIZED" || !p.coverage.completeScopeConfirmed
      || p.blockers.length > 0 || n.addedPeople + n.updatedPeople + n.removedPeople + n.addedAbsenceDays + n.removedAbsenceDays + n.assignmentChanges + i.references.length > 0
      || p.effect.approvalInvalidated || p.effect.approvedPolicyVersionIdBefore !== p.effect.approvedPolicyVersionIdAfter)
    || p.canApply && (!p.coverage.completeScopeConfirmed || p.blockers.length > 0 || p.layout === "UNRECOGNIZED")
    || p.canApply && (p.purpose === "EMPLOYEES" ? n.addedPeople + n.updatedPeople + n.unchangedPeople === 0 : n.addedAbsenceDays + n.unchangedAbsenceDays === 0)
    || [...i.absences.added, ...i.absences.removed, ...i.assignments].some(d => d.date < command.startDate || d.date > command.endDate)
    || i.absences.unchanged.some(d => d.date < workspace.input.startDate || d.date > workspace.input.endDate
      || people.get(d.employeeId) !== d.registration || !preservedAbsences.has(JSON.stringify([d.employeeId, d.date])))) throw invalid();
  if (command.action === "APPLY_REPLACE" && (p.expectedImpactHash !== command.expectedImpactHash || !p.canApply)) throw invalid();
  return p;
}

export async function requestImportReplacement(file: File, rawCommand: ImportSyncCommand, workspace: EscalaWorkspace, signal: AbortSignal): Promise<ImportReplacementResult> {
  signal.throwIfAborted();
  if (!isImportSyncFileSizeAllowed(file.size)) throw new Error(importReplacementFileSizeMessage);
  const command = importSyncCommandSchema.parse(rawCommand);
  const timeout = new AbortController(), combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error("A espera excedeu o prazo.")), IMPORT_REPLACEMENT_TIMEOUT);
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(combined.reason); combined.addEventListener("abort", onAbort, { once: true }); });
  try {
    combined.throwIfAborted();
    return await Promise.race([(async () => {
      const fileHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
      combined.throwIfAborted();
      const form = new FormData(); form.set("file", file); form.set("command", JSON.stringify(command));
      const response = await fetch("/api/escalas/import", { method: "POST", cache: "no-store", body: form, signal: combined });
      combined.throwIfAborted();
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        combined.throwIfAborted();
        if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
        throw new Error(response.status === 409 ? "A revisão mudou. Recarregue o planejamento e confira o arquivo novamente." : typeof body?.error?.message === "string" ? body.error.message : "Não foi possível confirmar a importação. Confira o acesso e tente novamente.");
      }
      const body = await response.json(); combined.throwIfAborted();
      if (command.action === "PREVIEW_REPLACE") {
        const preview = validateImportPreview(body?.preview, command, workspace);
        if (preview.fileHash !== fileHash) throw invalid();
        return { preview };
      }
      const summary = validateImportPreview(body?.summary, command, workspace), saved = parseSavedWorkspace(body?.workspace);
      if (summary.fileHash !== fileHash) throw invalid();
      if (saved.id !== workspace.id || saved.revision !== workspace.revision + 1 || saved.status !== "DRAFT" || saved.input.branchCode !== workspace.input.branchCode
        || saved.input.startDate !== workspace.input.startDate || saved.input.endDate !== workspace.input.endDate || (saved.input.visibleMonth ?? null) !== (workspace.input.visibleMonth ?? null)) throw invalid();
      return { workspace: saved, summary };
    })(), cancelled]);
  } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); }
}
