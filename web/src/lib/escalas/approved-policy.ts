import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";
import { isDate } from "./dates";
import { escalaInputSchema } from "./schema";
import { manualCatalogShift } from "./shift-catalog/manual-override";
import type { EscalaEmployee, EscalaInput } from "./types";

export const ESCALA_APPROVED_POLICY_SCHEMA_VERSION = 1;
const id = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u);
const positiveVersion = z.number().int().min(1).max(2_147_483_647);
const fields = escalaInputSchema.shape;
const employeeFields = fields.employees.element.shape;
const configurationSchema = z.strictObject({
  schemaVersion: fields.schemaVersion, restRulesVersion: fields.restRulesVersion,
  generationMode: fields.generationMode, simulation: fields.simulation,
  branchCode: fields.branchCode, branchName: fields.branchName,
  startDate: fields.startDate, endDate: fields.endDate, visibleMonth: fields.visibleMonth,
  defaultWeeklyHours: fields.defaultWeeklyHours, timeZone: fields.timeZone,
  storeClosingMinutes: fields.storeClosingMinutes, mixed42Sectors: fields.mixed42Sectors,
  policy: fields.policy, demands: fields.demands, movementPriorities: fields.movementPriorities,
});

// Closed list: new employees inherit these fields from a server-resolved approved model.
// Person-specific provenance, history, employment dates and manual selections are not templates.
const regimeSchema = z.strictObject({
  sector: employeeFields.sector, role: employeeFields.role,
  weeklyHours: employeeFields.weeklyHours, weeklyHoursMode: employeeFields.weeklyHoursMode,
  simulationDailyMinutes: employeeFields.simulationDailyMinutes,
  shiftIds: employeeFields.shiftIds, originalShiftIds: employeeFields.originalShiftIds,
  planningEnabled: employeeFields.planningEnabled, scheduleMode: employeeFields.scheduleMode,
  planningExclusionReason: employeeFields.planningExclusionReason,
  offMode: employeeFields.offMode, fixedOffDays: employeeFields.fixedOffDays,
  offPattern: employeeFields.offPattern, maxConsecutiveSundays: employeeFields.maxConsecutiveSundays,
  sundayRestRule: employeeFields.sundayRestRule,
});
const originSchema = z.strictObject({ workspaceId: id, revision: positiveVersion });
const provenanceSchema = z.strictObject({
  tenantId: id, approvedById: id, approvedAt: z.iso.datetime({ precision: 3 }),
  origin: originSchema.nullable(),
});
const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(ESCALA_APPROVED_POLICY_SCHEMA_VERSION),
  configuration: configurationSchema,
  seed: z.strictObject({ employees: fields.employees, shifts: fields.shifts, assignments: fields.assignments }),
  regimeModels: z.array(z.strictObject({ id, label: z.string().trim().min(1).max(160),
    sourceEmployeeId: id, protectedFields: regimeSchema })).min(1).max(250),
  provenance: provenanceSchema,
});
export type EscalaApprovedPolicySnapshot = z.output<typeof snapshotSchema>;
export type EscalaApprovedRegimeModel = EscalaApprovedPolicySnapshot["regimeModels"][number];
export type EscalaApprovedPolicyCandidate = Readonly<{
  tenantId: string; branchCode: string; startDate: string; endDate: string; visibleMonth: string | null;
  version: number; snapshotSchemaVersion: 1; snapshot: EscalaApprovedPolicySnapshot; snapshotHash: string;
  approvedById: string; approvedAt: string; originWorkspaceId: string | null; originRevision: number | null;
}>;
type Failure = Readonly<{ ok: false; code: "INVALID_APPROVED_POLICY" }>;
type Result<T> = Readonly<{ ok: true; value: T }> | Failure;
const failure = (): Failure => ({ ok: false, code: "INVALID_APPROVED_POLICY" });

/** JSON-only, sorted object keys; array order remains meaningful. Never hashes JSONB text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hashSnapshot(snapshot: EscalaApprovedPolicySnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}
function regimeOf(person: EscalaEmployee) {
  return regimeSchema.parse(Object.fromEntries(Object.keys(regimeSchema.shape)
    .map(key => [key, person[key as keyof EscalaEmployee]])));
}
function cleanSeedEmployee(person: EscalaEmployee): EscalaEmployee {
  const copy = structuredClone(person);
  delete copy.planningHistory;
  delete copy.planningFuture;
  return copy;
}
function inputOf(snapshot: EscalaApprovedPolicySnapshot): EscalaInput {
  return { ...structuredClone(snapshot.configuration), ...structuredClone(snapshot.seed) };
}

function coherent(snapshot: EscalaApprovedPolicySnapshot): boolean {
  const input = inputOf(snapshot);
  if (!escalaInputSchema.safeParse(input).success || input.employees.length === 0) return false;
  if (input.branchCode !== canonicalBranchCode(input.branchCode)) return false;
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(input.branchCode)) return false;
  if (!input.policy.reviewed || !input.policy.source || !input.policy.reviewedBy
    || input.policy.validFrom > input.startDate || input.policy.validUntil < input.endDate) return false;
  const modelIds = new Set<string>();
  for (const model of snapshot.regimeModels) {
    const person = input.employees.find(employee => employee.id === model.sourceEmployeeId);
    if (modelIds.has(model.id) || !person || canonicalJson(regimeOf(person)) !== canonicalJson(model.protectedFields)) return false;
    modelIds.add(model.id);
  }
  const shiftIds = new Set(input.shifts.map(shift => shift.id));
  for (const person of input.employees) {
    if (person.planningHistory || person.planningFuture) return false;
    if (person.scheduleMode === undefined || person.scheduleMode === "MISSING") return false;
    if (person.scheduleMode === "TIMED" && person.shiftIds.length === 0 && !person.manualShiftOverrides?.length) return false;
    if (person.fixedImportedShiftId && !shiftIds.has(person.fixedImportedShiftId)) return false;
    if (person.manualShiftOverrides?.some(selection => !shiftIds.has(selection.shiftId))) return false;
    if (person.manualShiftOverrides?.some(selection => canonicalJson(manualCatalogShift(selection).segments)
      !== canonicalJson(input.shifts.find(shift => shift.id === selection.shiftId)?.segments))) return false;
    if (person.scheduleMode === "UNTIMED" && person.shiftIds.length) return false;
    // A model cannot silently discard person-specific manual selections or derived restrictions.
    if (snapshot.regimeModels.some(model => model.sourceEmployeeId === person.id)
      && (person.manualShiftOverrides || person.manualShiftByDate || person.fixedImportedShiftId)) return false;
  }
  return input.assignments.every(entry => (entry.kind === "ABSENCE" || entry.kind === "HOLIDAY")
    && (entry.kind !== "HOLIDAY" || input.policy.holidayDates.includes(entry.date))
    && input.employees.some(person => person.id === entry.employeeId
      && (!person.activeFrom || entry.date >= person.activeFrom) && (!person.activeUntil || entry.date <= person.activeUntil)));
}

const buildSchema = z.strictObject({
  input: escalaInputSchema, version: positiveVersion, provenance: provenanceSchema,
  selectedSeedAssignments: z.array(z.strictObject({ employeeId: id, date: z.string().refine(isDate),
    kind: z.enum(["ABSENCE", "HOLIDAY"]) })).max(10500),
  regimeModelSelections: z.array(z.strictObject({ id, label: z.string().trim().min(1).max(160), employeeId: id })).min(1).max(250),
});

/** Pure server-side preparation, NOT an authorization or database write. No override materialization. */
export function buildEscalaApprovedPolicy(value: unknown): Result<EscalaApprovedPolicyCandidate> {
  const parsed = buildSchema.safeParse(value);
  if (!parsed.success) return failure();
  const { input, provenance, version, selectedSeedAssignments, regimeModelSelections } = parsed.data;
  // Schema normalization must not hide a noncanonical identity at this boundary.
  const rawInput = (value as { input: { branchCode: string } }).input;
  if (rawInput.branchCode !== input.branchCode) return failure();
  // Published continuity needs a canonical server reload that this pure stage cannot provide.
  if (input.employees.some(person => person.planningHistory?.length || person.planningFuture?.length)) return failure();
  const selected = new Set<string>();
  const assignments: EscalaInput["assignments"] = [];
  for (const choice of selectedSeedAssignments) {
    const key = `${choice.employeeId}\0${choice.date}`;
    const entry = input.assignments.find(item => item.employeeId === choice.employeeId && item.date === choice.date && item.kind === choice.kind);
    if (selected.has(key) || !entry) return failure();
    selected.add(key);
    assignments.push(structuredClone(entry));
  }
  const models: EscalaApprovedRegimeModel[] = [];
  for (const choice of regimeModelSelections) {
    const person = input.employees.find(employee => employee.id === choice.employeeId);
    if (!person) return failure();
    models.push({ id: choice.id, label: choice.label, sourceEmployeeId: person.id, protectedFields: regimeOf(person) });
  }
  const config = Object.fromEntries(Object.keys(configurationSchema.shape)
    .map(key => [key, input[key as keyof EscalaInput]]));
  const snapshot = snapshotSchema.parse({ schemaVersion: 1, configuration: config,
    seed: { employees: input.employees.map(cleanSeedEmployee), shifts: input.shifts, assignments },
    regimeModels: models, provenance });
  if (!coherent(snapshot)) return failure();
  return { ok: true, value: {
    tenantId: provenance.tenantId, branchCode: input.branchCode,
    startDate: input.startDate, endDate: input.endDate, visibleMonth: input.visibleMonth ?? null,
    version, snapshotSchemaVersion: 1, snapshot, snapshotHash: hashSnapshot(snapshot),
    approvedById: provenance.approvedById, approvedAt: provenance.approvedAt,
    originWorkspaceId: provenance.origin?.workspaceId ?? null, originRevision: provenance.origin?.revision ?? null,
  } };
}

/** Re-validate stored JSON and integrity before using it; service must also check row/tenant/revocation. */
export function readEscalaApprovedPolicy(snapshot: unknown, expectedHash: string): Result<EscalaApprovedPolicySnapshot> {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success || !/^[a-f0-9]{64}$/.test(expectedHash)
    || hashSnapshot(parsed.data) !== expectedHash || !coherent(parsed.data)) return failure();
  if ((snapshot as EscalaApprovedPolicySnapshot).configuration.branchCode !== parsed.data.configuration.branchCode) return failure();
  return { ok: true, value: structuredClone(parsed.data) };
}

/** Exact approved period only. A service must authorize and recheck the selected row transactionally. */
export function createInputFromEscalaApprovedPolicy(snapshot: unknown, expectedHash: string): Result<EscalaInput> {
  const result = readEscalaApprovedPolicy(snapshot, expectedHash);
  return result.ok ? { ok: true, value: inputOf(result.value) } : result;
}

const enrollmentSchema = z.strictObject({
  id, regimeModelId: id, name: employeeFields.name, registration: employeeFields.registration,
  activeFrom: employeeFields.activeFrom, activeUntil: employeeFields.activeUntil,
  preferredOffDays: employeeFields.preferredOffDays,
});
/** Server picks the stored model; client cannot provide protected regime fields. Returns a fresh input. */
export function addEmployeeFromEscalaApprovedModel(snapshot: unknown, expectedHash: string,
  enrollment: unknown): Result<EscalaInput> {
  const approved = readEscalaApprovedPolicy(snapshot, expectedHash);
  const parsed = enrollmentSchema.safeParse(enrollment);
  if (!approved.ok || !parsed.success) return failure();
  const { regimeModelId, ...person } = parsed.data;
  const model = approved.value.regimeModels.find(item => item.id === regimeModelId);
  if (!model) return failure();
  const input = inputOf(approved.value);
  input.employees.push({ ...structuredClone(model.protectedFields), ...person, historyKnown: false, history: [] });
  const checked = escalaInputSchema.safeParse(input);
  return checked.success ? { ok: true, value: checked.data } : failure();
}
