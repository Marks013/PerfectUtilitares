import { createHash } from "node:crypto";
import { employeeReferenceShiftChoices } from "./reference-choices";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEscala } from "../service";
import { EscalaError } from "../errors";
import { canonicalBranchCode } from "../branch-code";
import { effectiveScheduleMode } from "../fpre136-schedule";
import type { EscalaActor } from "../access";
import type { EscalaWorkspace } from "../types";
import type {
  TurnoExportManifestDto,
  TurnoExportManifestRequest,
  TurnoExportOmissionDto,
  TurnoExportSelection,
} from "./contracts";
import { clockMinutes, markingsFromShift, renderTurnoTxt, type TurnoTxtRow } from "./domain";
import type { TurnoUnrepresentableReason } from "./domain";
import { readTurnoManifest, storeTurnoManifest, type TurnoManifestPayload } from "./catalog";

type CatalogCodeRow = { code: number; firstIn: number; firstOut: number; secondIn: number; secondOut: number };
type SelectedWorkspace = { workspace: EscalaWorkspace; selection: TurnoExportSelection };

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function hashRows(rows: readonly TurnoTxtRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function omission(
  workspaceId: string,
  employeeId: string,
  registration: string,
  reason: TurnoExportOmissionDto["reason"],
): TurnoExportOmissionDto {
  return { workspaceId, employeeId, registration, reason };
}

async function selectedWorkspaces(actor: EscalaActor, month: number, year: number, selections: readonly TurnoExportSelection[]): Promise<SelectedWorkspace[]> {
  const { start, end } = monthRange(year, month);
  const seenBranches = new Set<string>();
  const selected: SelectedWorkspace[] = [];
  for (const selection of selections) {
    const workspace = await getEscala(actor, selection.workspaceId);
    if (workspace.revision !== selection.revision) throw new EscalaError(409, "TURNO_REVISION_CONFLICT", "A revisão do planejamento mudou. Atualize a prévia de exportação.");
    if ((workspace.input.visibleMonth ?? workspace.input.startDate.slice(0, 7)) !== `${year}-${String(month).padStart(2, "0")}`) {
      throw new EscalaError(409, "TURNO_MONTH_MISMATCH", "O planejamento selecionado não corresponde ao mês escolhido.");
    }
    if (workspace.input.startDate > end || workspace.input.endDate < start) {
      throw new EscalaError(409, "TURNO_MONTH_OUTSIDE_PLAN", "O planejamento não cobre o mês selecionado.");
    }
    const branchCode = canonicalBranchCode(workspace.input.branchCode);
    if (seenBranches.has(branchCode)) throw new EscalaError(400, "TURNO_DUPLICATE_BRANCH", "Selecione somente um planejamento por filial.");
    seenBranches.add(branchCode);
    const employeeIds = new Set<string>();
    for (const employee of selection.employees) {
      if (employeeIds.has(employee.employeeId)) throw new EscalaError(400, "TURNO_DUPLICATE_EMPLOYEE", "A seleção contém um colaborador repetido.");
      employeeIds.add(employee.employeeId);
    }
    const knownEmployeeIds = new Set(workspace.input.employees.map(employee => employee.id));
    if ([...employeeIds].some(employeeId => !knownEmployeeIds.has(employeeId))) {
      throw new EscalaError(400, "TURNO_EMPLOYEE_NOT_FOUND", "A seleção contém um colaborador que não pertence ao planejamento.");
    }
    selected.push({ workspace, selection });
  }
  if (selected.length === 0) throw new EscalaError(400, "TURNO_EMPTY_EXPORT", "Selecione ao menos um planejamento.");
  return selected.sort((a, b) => a.workspace.input.branchCode.localeCompare(b.workspace.input.branchCode));
}

async function catalogCodeMap(actor: EscalaActor, selected: readonly SelectedWorkspace[]) {
  const tuples = new Map<string, [number, number, number, number]>();
  for (const { workspace, selection } of selected) {
    const shifts = new Map(workspace.input.shifts.map(shift => [shift.id, shift]));
    for (const choice of selection.employees) {
      const shift = shifts.get(choice.localShiftId);
      if (!shift) continue;
      const markings = markingsFromShift(shift);
      if (!markings.ok) continue;
      const tuple = markings.markings.map(value => (clockMinutes(value) as number)) as [number, number, number, number];
      tuples.set(tuple.join("|"), tuple);
    }
  }
  if (tuples.size === 0) return new Map<string, number>();
  const clauses = [...tuples.values()].map(([firstIn, firstOut, secondIn, secondOut]) => Prisma.sql`("firstIn" = ${firstIn} AND "firstOut" = ${firstOut} AND "secondIn" = ${secondIn} AND "secondOut" = ${secondOut})`);
  const rows = await prisma.$queryRaw<CatalogCodeRow[]>`
    SELECT "code", "firstIn", "firstOut", "secondIn", "secondOut"
    FROM "ShiftCatalogEntry"
    WHERE "tenantId" = ${actor.tenantId} AND (${Prisma.join(clauses, " OR ")})
  `;
  return new Map(rows.map(row => [[row.firstIn, row.firstOut, row.secondIn, row.secondOut].join("|"), row.code]));
}

async function buildExportRows(actor: EscalaActor, month: number, year: number, selections: readonly TurnoExportSelection[]) {
  const selected = await selectedWorkspaces(actor, month, year, selections);
  const codes = await catalogCodeMap(actor, selected);
  const { start, end } = monthRange(year, month);
  const rows: TurnoTxtRow[] = [];
  const omissions: TurnoExportOmissionDto[] = [];
  const seenRegistrations = new Set<string>();

  for (const { workspace, selection } of selected) {
    const input = workspace.input;
    const people = input.employees.filter(person => person.activeFrom <= end && (!person.activeUntil || person.activeUntil >= start))
      .sort((a, b) => a.registration.localeCompare(b.registration) || a.id.localeCompare(b.id));
    const choices = new Map(selection.employees.map(choice => [choice.employeeId, choice.localShiftId]));
    const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));

    for (const person of people) {
      const mode = effectiveScheduleMode(person);
      const localShiftId = choices.get(person.id);
      if (!localShiftId) {
        omissions.push(omission(workspace.id, person.id, person.registration, mode === "UNTIMED" ? "UNTIMED" : "NO_REFERENCE"));
        continue;
      }
      if (/[,"\u2028\u2029\p{Cc}]/u.test(person.registration)) {
        throw new EscalaError(422, "TURNO_REGISTRATION_UNSUPPORTED", "A matrícula contém delimitador ou caractere de controle. Corrija o valor na origem antes de gerar o TXT.");
      }
      if (mode === "MISSING") {
        omissions.push(omission(workspace.id, person.id, person.registration, "MISSING"));
        continue;
      }
      if (mode === "UNTIMED") {
        omissions.push(omission(workspace.id, person.id, person.registration, "UNTIMED"));
        continue;
      }
      const shift = shifts.get(localShiftId);
      if (!shift || !employeeReferenceShiftChoices({ ...input, visibleMonth: `${year}-${String(month).padStart(2, "0")}` }, person).some(choice => choice.shiftId === localShiftId)) {
        omissions.push(omission(workspace.id, person.id, person.registration, "NO_REFERENCE"));
        continue;
      }
      const markings = markingsFromShift(shift);
      if (!markings.ok) {
        omissions.push(omission(workspace.id, person.id, person.registration, (markings.reason as TurnoUnrepresentableReason)));
        continue;
      }
      const tuple = markings.markings.map(value => (clockMinutes(value) as number)).join("|");
      const code = codes.get(tuple);
      if (!code) {
        omissions.push(omission(workspace.id, person.id, person.registration, "CATALOG_REQUIRED"));
        continue;
      }
      if (seenRegistrations.has(person.registration)) {
        omissions.push(omission(workspace.id, person.id, person.registration, "DUPLICATE_REGISTRATION"));
        continue;
      }
      seenRegistrations.add(person.registration);
      rows.push({ registration: person.registration, code, markings: markings.markings });
    }
  }
  return { rows, omissions, selected };
}

export async function createTurnoExportManifest(actor: EscalaActor, request: TurnoExportManifestRequest): Promise<TurnoExportManifestDto> {
  const { rows, omissions, selected } = await buildExportRows(actor, request.month, request.year, request.selections);
  const selections = selected.map(({ workspace, selection }) => ({
    workspaceId: workspace.id,
    revision: workspace.revision,
    employees: [...selection.employees].sort((a, b) => a.employeeId.localeCompare(b.employeeId)),
  }));
  const payload: TurnoManifestPayload = {
    version: 1,
    month: request.month,
    year: request.year,
    selections,
    rowsHash: hashRows(rows),
  };
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const manifestId = await storeTurnoManifest(actor, payload, expiresAt);
  return {
    manifestId,
    expiresAt: expiresAt.toISOString(),
    month: request.month,
    year: request.year,
    rowCount: rows.length,
    omissions,
    formats: ["TXT1", "TXT2"],
  };
}

export async function downloadTurnoExport(actor: EscalaActor, manifestId: string, format: "TXT1" | "TXT2", acceptOmissions: boolean) {
  const payload = await readTurnoManifest(actor, manifestId);
  const { rows, omissions } = await buildExportRows(actor, payload.month, payload.year, payload.selections);
  if (hashRows(rows) !== payload.rowsHash) throw new EscalaError(409, "TURNO_MANIFEST_STALE", "O recorte da exportação mudou. Gere uma nova prévia.");
  if (rows.length === 0) throw new EscalaError(409, "TURNO_EXPORT_EMPTY", "Não há horários válidos para exportar.");
  if (omissions.length > 0 && !acceptOmissions) throw new EscalaError(409, "TURNO_EXPORT_OMISSIONS", "Revise os horários omitidos e confirme explicitamente para baixar o arquivo.");
  return {
    bytes: renderTurnoTxt(format, rows),
    omissions,
    month: payload.month,
    year: payload.year,
  };
}

