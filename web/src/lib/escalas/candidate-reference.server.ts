import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { EscalaError } from "./errors";
import { escalaInputSchema } from "./schema";
import { candidateReferenceSignature } from "./solver-transport";
import { compareRosterCoverage, isOperationallyReusable, selectVerifiedRoster } from "./roster-quality";
import { validateEscala } from "./validation";
import { matchesRestOnlyReferences } from "./generation";
import { matchesHoursOnlyAssignments } from "./hours-reference";
import { manualAssignmentIssues } from "./shift-catalog/manual-override";
import type { EscalaCandidateComparison, EscalaCandidateReceipt } from "./candidate-reference";
import type { EscalaInput } from "./types";

type Scope = { tenantId: string; owner: string; workspaceId: string; revision: number };
type Admission = { input?: EscalaInput; comparison: EscalaCandidateComparison };
const TTL = 15 * 60_000;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ version: z.literal(1), workspaceId: z.string().min(1).max(100), revision: z.number().int().min(1),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  baseHash: hex, contextHash: hex, inputHash: hex, signature: hex }).strict();
const referenceSchema = z.object({ input: escalaInputSchema, receipt: receiptSchema }).strict();
const collections = new Set(["employees", "shifts", "demands", "assignments", "history", "planningHistory", "planningFuture"]);
/** Object/database order is irrelevant; segment and selected-option order remain meaningful. */
function canonical(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) {
    const items = value.map(entry => canonical(entry));
    return collections.has(field) ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry, key)])) : value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function inputDigest(input: EscalaInput) { return digest(escalaInputSchema.parse(input)); }
function signature(scope: Scope, receipt: Omit<EscalaCandidateReceipt, "signature">) {
  return candidateReferenceSignature(JSON.stringify(canonical({ tenantId: scope.tenantId, owner: scope.owner, receipt })));
}
const invalid = () => new EscalaError(400, "ESCALA_COMPARISON_REFERENCE_INVALID", "A referência de comparação não pôde ser autenticada. Gere uma nova proposta sem reutilizar essa referência.");
const unused = (admission: EscalaCandidateComparison["admission"], reason?: string): Admission => ({ comparison: { admission, selection: "NOT_USED", ...(reason ? { reason } : {}) } });

export function issueCandidateReceipt(scope: Scope, base: EscalaInput, context: EscalaInput, input: EscalaInput, now = Date.now()): EscalaCandidateReceipt {
  const receipt = { version: 1 as const, workspaceId: scope.workspaceId, revision: scope.revision, issuedAt: now, expiresAt: now + TTL,
    baseHash: inputDigest(base), contextHash: inputDigest(context), inputHash: inputDigest(input) };
  return { ...receipt, signature: signature(scope, receipt) };
}

export function admitCandidateReference(value: unknown, scope: Scope, base: EscalaInput, context: EscalaInput, now = Date.now()): Admission {
  if (value === undefined) return unused("NOT_PROVIDED");
  const parsed = referenceSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { input, receipt } = parsed.data;
  const { signature: received, ...unsigned } = receipt;
  const expected = signature(scope, unsigned);
  // Authenticate first, including expired receipts. Expiration must never disguise tampering.
  if (!timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"))
    || receipt.workspaceId !== scope.workspaceId || receipt.inputHash !== inputDigest(input)
    || receipt.expiresAt - receipt.issuedAt !== TTL || receipt.issuedAt > now + 30_000) throw invalid();
  if (receipt.expiresAt <= now) return unused("EXPIRED", "REFERENCE_EXPIRED");
  context = escalaInputSchema.parse(context);
  if (receipt.revision !== scope.revision || receipt.baseHash !== inputDigest(base) || receipt.contextHash !== digest(context)) return unused("SCENARIO_CHANGED", "CURRENT_CONTEXT_CHANGED");
  // The signed proposal must still be an admissible full roster of this exact authoritative context.
  const definition = ({ assignments: _days, needsRegeneration: _stale, generationBasis: _basis, ...rest }: EscalaInput) => rest;
  if (digest(definition(input)) !== digest(definition(context))) return unused("INCOMPATIBLE", "INPUT_DEFINITION_CHANGED");
  const days = new Map(input.assignments.map(day => [JSON.stringify([day.employeeId, day.date]), day]));
  if (context.assignments.some(old => {
    if (!old.locked && old.kind !== "ABSENCE" && old.kind !== "HOLIDAY") return false;
    const next = days.get(JSON.stringify([old.employeeId, old.date]));
    return next?.kind !== old.kind || next.locked !== old.locked || next.shiftId !== old.shiftId;
  })) return unused("INCOMPATIBLE", "PROTECTED_ASSIGNMENT_CHANGED");
  if (!isOperationallyReusable(validateEscala(input)) || !matchesRestOnlyReferences(context, input.assignments)
    || !matchesHoursOnlyAssignments(context, input) || manualAssignmentIssues(input, context.assignments).length) return unused("INCOMPATIBLE", "REFERENCE_NOT_REUSABLE");
  return { input, comparison: { admission: "ADMITTED", selection: "NOT_USED" } };
}

export function selectCandidateReference(admitted: Admission, candidate: EscalaInput, ruler: EscalaInput): { input: EscalaInput; comparison: EscalaCandidateComparison } {
  if (!admitted.input) return { input: candidate, comparison: admitted.comparison };
  if (!compareRosterCoverage(admitted.input, candidate, ruler).comparable) return { input: candidate, comparison: { admission: "INCOMPATIBLE", selection: "NOT_USED", reason: "REFERENCE_NOT_COMPARABLE" } };
  let reason = "ACCEPTED";
  const selected = selectVerifiedRoster(admitted.input, candidate, value => { reason = value; }, ruler);
  return { input: selected.input, comparison: { admission: "ADMITTED", selection: selected.retainedReference ? "REFERENCE_RETAINED" : "CANDIDATE_SELECTED", reason } };
}
