import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getEscala } from "../service";
import { requireEscalaCapability, type EscalaActor } from "../access";
import { EscalaError } from "../errors";
import { canonicalBranchCode } from "../branch-code";
import { effectiveScheduleMode } from "../fpre136-schedule";
import { isAdministrativeEscalaSector } from "../eligibility";
import { stableEscalaJson } from "../operational-input-policy";
import type { EscalaEmployee, EscalaWorkspace } from "../types";
import { visibleDates } from "../dates";
import { employeeReferenceShiftChoices } from "./reference-choices";
import { clockMinutes, markingKey, markingsFromShift, minutesClock, renderTurnoTxt } from "./domain";
import type { TurnoCatalogEntryDto } from "./contracts";
import { storeTurnoManifest } from "./catalog";
import { turnoSelectionManifestSchema, type TurnoSelectionManifestRequest, type TurnoSelectionManifestDto,
  type TurnoFlowPersonKey, type TurnoSelectionOmission, type TurnoEmployeeExportLine, type TurnoSelectionBlocker } from "./flow-contracts";

export type TurnoSelectionPayload = { version: 2; request: TurnoSelectionManifestRequest; selectionDigest: string };
type Reference = { id: string; source: string; label: string; markings?: TurnoCatalogEntryDto["markings"];
  code?: number; reason?: TurnoSelectionOmission["reason"] };
type Person = TurnoFlowPersonKey & { employee: EscalaEmployee; branchCode: string; references: Reference[] };
const key = (value: TurnoFlowPersonKey) => JSON.stringify([value.workspaceId, value.employeeId]);
const compare = (left: unknown, right: unknown) => stableEscalaJson(left).localeCompare(stableEscalaJson(right));
const error = (code: string, message: string, status = 400): never => { throw new EscalaError(status, code, message); };

function normalize(value: TurnoSelectionManifestRequest): TurnoSelectionManifestRequest {
  const parsed = turnoSelectionManifestSchema.safeParse(value);
  if (!parsed.success) return error("TURNO_INVALID_SELECTION", "Confira a seleção, os filtros e os limites do arquivo.");
  const request = parsed.data;
  request.sources.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
  request.filters = { branchCodes: [...new Set(request.filters.branchCodes.map(canonicalBranchCode))].sort(),
    employeeKeys: [...new Map(request.filters.employeeKeys.map(entry => [key(entry), entry])).values()].sort(compare),
    sectors: [...new Map(request.filters.sectors.map(entry => [stableEscalaJson(entry), entry])).values()].sort(compare),
    catalogCodes: [...new Set(request.filters.catalogCodes)].sort((a, b) => a - b),
    registrations: [...new Set(request.filters.registrations)].sort() };
  if (request.mode === "CATALOG") request.codes.sort((a, b) => a - b);
  else request.members.sort((a, b) => key(a).localeCompare(key(b)));
  return request;
}

function referenceChoices(workspace: EscalaWorkspace, employee: EscalaEmployee, month: string): Reference[] {
  const input = { ...workspace.input, visibleMonth: month };
  const dates = new Set(visibleDates(input).filter(date => date >= employee.activeFrom && (!employee.activeUntil || date <= employee.activeUntil)));
  const work = input.assignments.filter(day => day.employeeId === employee.id && day.kind === "WORK" && dates.has(day.date));
  const choices = employeeReferenceShiftChoices(input, employee);
  // Missing WORK IDs remain diagnostics; never fall back to a base reference when WORK exists.
  const associated = work.length ? work.flatMap(day => day.shiftId ? [day.shiftId] : [])
    : [...employee.shiftIds, ...(employee.manualShiftOverrides ?? []).filter(entry => [...dates].some(date => date >= entry.effectiveFrom && date <= entry.effectiveUntil)).map(entry => entry.shiftId)];
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const references: Reference[] = choices.map(choice => {
    const shift = shifts.get(choice.shiftId), result = shift && markingsFromShift(shift);
    return { id: choice.shiftId, source: choice.source, label: choice.label,
      ...(result?.ok ? { markings: result.markings } : { reason: result && !result.ok ? result.reason : "STALE_REFERENCE" }) };
  });
  for (const id of new Set(associated)) if (!shifts.has(id)) references.push({ id, source: work.length ? "WORK" : "BASE", label: "Referência indisponível", reason: "STALE_REFERENCE" });
  return references.sort((a, b) => a.id.localeCompare(b.id));
}

async function sourcePeople(actor: EscalaActor, request: TurnoSelectionManifestRequest) {
  const month = `${request.year}-${String(request.month).padStart(2, "0")}`, start = month + "-01";
  const end = `${month}-${String(new Date(Date.UTC(request.year, request.month, 0)).getUTCDate()).padStart(2, "0")}`;
  const people: Person[] = [], branches = new Set<string>();
  const rawEmployeeKeys = new Set<string>(), administrativeKeys = new Set<string>();
  for (const source of request.sources) {
    const workspace = await getEscala(actor, source.workspaceId);
    if (workspace.revision !== source.revision) return error("TURNO_REVISION_CONFLICT", "O planejamento mudou. Confira a seleção novamente.", 409);
    if ((workspace.input.visibleMonth ?? workspace.input.startDate.slice(0, 7)) !== month
      || workspace.input.startDate > end || workspace.input.endDate < start) return error("TURNO_MONTH_MISMATCH", "A fonte não corresponde ao mês selecionado.", 409);
    const branchCode = canonicalBranchCode(workspace.input.branchCode);
    if (branches.has(branchCode)) return error("TURNO_DUPLICATE_BRANCH", "Selecione somente um planejamento por filial.");
    branches.add(branchCode);
    for (const employee of workspace.input.employees) {
      const employeeKey = key({ workspaceId: workspace.id, employeeId: employee.id });
      rawEmployeeKeys.add(employeeKey);
      if (isAdministrativeEscalaSector(employee.sector)) {
        administrativeKeys.add(employeeKey);
        continue;
      }
      if (employee.activeFrom > end || (employee.activeUntil && employee.activeUntil < start)) continue;
      const projectedEmployee = { ...employee,
        manualShiftOverrides: employee.manualShiftOverrides?.filter(entry => entry.effectiveFrom <= end && entry.effectiveUntil >= start) };
      people.push({ workspaceId: workspace.id, employeeId: employee.id, employee: projectedEmployee, branchCode,
        references: referenceChoices(workspace, projectedEmployee, month) });
    }
  }
  return { people, rawEmployeeKeys, administrativeKeys };
}

async function catalogEntries(actor: EscalaActor, people: Person[], explicitCodes: number[]) {
  const tuples = new Map<string, { firstIn: number; firstOut: number; secondIn: number; secondOut: number }>();
  for (const person of people) for (const reference of person.references) if (reference.markings) {
    const [firstIn, firstOut, secondIn, secondOut] = reference.markings.map(value => clockMinutes(value) as number);
    tuples.set(markingKey(reference.markings), { firstIn, firstOut, secondIn, secondOut });
  }
  const entries = new Map<number, TurnoCatalogEntryDto>();
  const predicates = [...tuples.values(), ...explicitCodes.map(code => ({ code }))];
  for (let offset = 0; offset < predicates.length; offset += 250) {
    const rows = await prisma.shiftCatalogEntry.findMany({ where: { tenantId: actor.tenantId, OR: predicates.slice(offset, offset + 250) },
      select: { code: true, firstIn: true, firstOut: true, secondIn: true, secondOut: true }, orderBy: { code: "asc" } });
    for (const row of rows) {
      if (row.firstOut <= row.firstIn || ((row.secondIn !== 0 || row.secondOut !== 0)
        && (row.secondIn < row.firstOut || row.secondOut <= row.secondIn))) {
        return error("TURNO_CATALOG_CORRUPT", "O catálogo contém períodos incompletos ou incompatíveis com o arquivo.", 409);
      }
      const marks = [row.firstIn, row.firstOut, row.secondIn, row.secondOut].map(minutesClock);
      if (marks.some(mark => mark === null)) return error("TURNO_CATALOG_CORRUPT", "O catálogo contém uma marcação inválida.", 409);
      const markings = marks as [string, string, string, string];
      entries.set(row.code, { code: row.code, markings, name: markings.join(" ") });
    }
  }
  const byTuple = new Map<string, TurnoCatalogEntryDto>();
  for (const entry of entries.values()) {
    const tuple = markingKey(entry.markings);
    if (byTuple.has(tuple) && byTuple.get(tuple)?.code !== entry.code) return error("TURNO_CATALOG_AMBIGUOUS", "Há códigos ambíguos para a mesma referência.", 409);
    byTuple.set(tuple, entry);
  }
  for (const person of people) for (const reference of person.references) if (reference.markings) {
    reference.code = byTuple.get(markingKey(reference.markings))?.code;
    if (!reference.code) reference.reason = "CATALOG_REQUIRED";
    const manual = person.employee.manualShiftOverrides?.filter(entry => entry.shiftId === reference.id) ?? [];
    if (manual.some(entry => entry.catalogCode !== reference.code || markingKey(entry.markings) !== markingKey(reference.markings as TurnoCatalogEntryDto["markings"]))) {
      reference.reason = "STALE_REFERENCE"; reference.code = undefined;
    }
  }
  return entries;
}

function matchesPerson(person: Person, request: TurnoSelectionManifestRequest) {
  const filter = request.filters;
  return (!filter.branchCodes.length || filter.branchCodes.includes(person.branchCode))
    && (!filter.employeeKeys.length || filter.employeeKeys.some(entry => key(entry) === key(person)))
    && (!filter.sectors.length || filter.sectors.some(entry => entry.workspaceId === person.workspaceId && entry.value === person.employee.sector))
    && (!filter.registrations.length || filter.registrations.includes(person.employee.registration));
}
function matchesReference(reference: Reference, request: TurnoSelectionManifestRequest) {
  return !request.filters.catalogCodes.length || (reference.code !== undefined && !reference.reason && request.filters.catalogCodes.includes(reference.code));
}

async function selectionSnapshot(actor: EscalaActor, value: TurnoSelectionManifestRequest) {
  const request = normalize(value);
  await requireEscalaCapability(actor, "export.integration");
  const { people, rawEmployeeKeys, administrativeKeys } = await sourcePeople(actor, request);
  if (request.mode === "EMPLOYEES") {
    if (request.members.some(member => !rawEmployeeKeys.has(key(member)))) {
      return error("TURNO_SELECTION_OUTSIDE_FILTER", "Uma pessoa não pertence às fontes, vínculos ou filtros conferidos.");
    }
    request.members = request.members.filter(member => !administrativeKeys.has(key(member)));
    if (!request.members.length) return error("TURNO_EXPORT_EMPTY", "Não há linhas válidas nesta seleção.", 409);
  }
  const { employeeKeys, sectors } = request.filters;
  const operationalEmployeeKeys = employeeKeys.filter(person => !administrativeKeys.has(key(person)));
  const operationalSectors = sectors.filter(sector => !isAdministrativeEscalaSector(sector.value));
  if ((employeeKeys.length && !operationalEmployeeKeys.length) || (sectors.length && !operationalSectors.length)) {
    return error("TURNO_SELECTION_OUTSIDE_FILTER", "Nenhuma pessoa do filtro pertence ao recorte operacional.");
  }
  request.filters = { ...request.filters, employeeKeys: operationalEmployeeKeys, sectors: operationalSectors };
  const entries = await catalogEntries(actor, people, request.mode === "CATALOG" ? request.codes : []);
  const filtered = people.filter(person => matchesPerson(person, request)
    && (!request.filters.catalogCodes.length || person.references.some(reference => matchesReference(reference, request))));
  const omissions: TurnoSelectionOmission[] = [], blockers: TurnoSelectionBlocker[] = [];
  const employeeRows: TurnoEmployeeExportLine[] = [], catalogRows: TurnoCatalogEntryDto[] = [];
  let found = 0;
  if (request.mode === "CATALOG") {
    const usedCodes = new Set(filtered.flatMap(person => person.references.filter(reference => !reference.reason && reference.code !== undefined && matchesReference(reference, request)).map(reference => reference.code as number)));
    const available = request.scope === "ALL" ? new Set(entries.keys()) : usedCodes;
    for (const selected of request.codes) {
      if (!available.has(selected) || (request.filters.catalogCodes.length && !request.filters.catalogCodes.includes(selected))) return error("TURNO_SELECTION_OUTSIDE_FILTER", "Um código não pertence ao recorte conferido.");
      const entry = entries.get(selected);
      if (!entry) return error("TURNO_NOT_FOUND", "O código não existe nesta empresa.", 404);
      catalogRows.push(entry);
    }
    if (request.scope === "ALL") found = await prisma.shiftCatalogEntry.count({ where: { tenantId: actor.tenantId,
      ...(request.filters.catalogCodes.length ? { code: { in: request.filters.catalogCodes } } : {}) } });
    else found = usedCodes.size;
  } else {
    found = filtered.length;
    const byKey = new Map(filtered.map(person => [key(person), person]));
    for (const member of request.members) {
      const person = byKey.get(key(member));
      if (!person) return error("TURNO_SELECTION_OUTSIDE_FILTER", "Uma pessoa não pertence às fontes, vínculos ou filtros conferidos.");
      const registration = person.employee.registration;
      if (/[,"\u2028\u2029\p{Cc}]/u.test(registration)) return error("TURNO_REGISTRATION_UNSUPPORTED", "Corrija a matrícula na origem antes de emitir o arquivo.", 422);
      const mode = effectiveScheduleMode(person.employee);
      const reference = member.localShiftId === null ? undefined : person.references.find(entry => entry.id === member.localShiftId);
      if (member.localShiftId !== null && (!reference || !matchesReference(reference, request))) return error("TURNO_SELECTION_OUTSIDE_FILTER", "A referência escolhida não pertence à pessoa e ao recorte conferido.");
      const reason: TurnoSelectionOmission["reason"] | undefined = !registration ? "REGISTRATION_MISSING"
        : mode === "UNTIMED" ? "UNTIMED" : mode === "MISSING" ? "MISSING"
        : reference?.reason ?? (!reference ? (person.references.length > 1 ? "AMBIGUOUS_REFERENCE" : "NO_REFERENCE") : undefined);
      if (reason || !reference?.markings || reference.code === undefined) {
        omissions.push({ workspaceId: member.workspaceId, employeeId: member.employeeId, registration, reason: reason ?? "CATALOG_REQUIRED" });
      } else employeeRows.push({ workspaceId: member.workspaceId, employeeId: member.employeeId, registration,
        localShiftId: reference.id, code: reference.code, markings: reference.markings });
    }
    const registrations = new Map<string, TurnoFlowPersonKey[]>();
    for (const member of request.members) {
      const registration = byKey.get(key(member))?.employee.registration;
      if (registration) registrations.set(registration, [...(registrations.get(registration) ?? []), { workspaceId: member.workspaceId, employeeId: member.employeeId }]);
    }
    for (const members of registrations.values()) if (members.length > 1) {
      blockers.push({ reason: "DUPLICATE_REGISTRATION", members, message: "Matrícula repetida. Corrija a origem ou retire explicitamente as pessoas da seleção." });
      for (const member of members) {
        const index = employeeRows.findIndex(row => key(row) === key(member));
        if (index >= 0) {
          const [row] = employeeRows.splice(index, 1);
          omissions.push({ workspaceId: member.workspaceId, employeeId: member.employeeId, registration: row.registration, reason: "DUPLICATE_REGISTRATION" });
        }
      }
    }
  }
  employeeRows.sort((a, b) => a.registration.localeCompare(b.registration) || key(a).localeCompare(key(b)));
  omissions.sort((a, b) => key(a).localeCompare(key(b)));
  const rows = request.mode === "CATALOG" ? catalogRows : employeeRows;
  const includedCodes = new Set(rows.map(row => row.code)).size;
  const counts = { found, selected: request.mode === "CATALOG" ? request.codes.length : request.members.length,
    includedEmployees: employeeRows.length, includedCodes, txt1Lines: employeeRows.length, txt2Lines: includedCodes,
    omitted: omissions.length, blockers: blockers.length };
  const snapshot = { request, rows, omissions, blockers, counts,
    references: people.filter(person => request.mode === "CATALOG" ? request.scope === "USED" && filtered.includes(person) : request.members.some(member => key(member) === key(person)))
      .map(person => ({ workspaceId: person.workspaceId, employeeId: person.employeeId, references: person.references })) };
  // Found is a navigation count, not part of the selected file. An unrelated catalog
  // addition must not invalidate an otherwise identical, explicit ALL selection.
  const selectionDigest = createHash("sha256").update(stableEscalaJson({ ...snapshot, counts: { ...counts, found: undefined } })).digest("hex");
  return { request, rows, omissions, blockers, counts, selectionDigest };
}

export async function createTurnoSelectionManifest(actor: EscalaActor, value: TurnoSelectionManifestRequest): Promise<TurnoSelectionManifestDto> {
  const snapshot = await selectionSnapshot(actor, value);
  await requireEscalaCapability(actor, "export.integration");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const manifestId = await storeTurnoManifest(actor, { version: 2, request: snapshot.request, selectionDigest: snapshot.selectionDigest }, expiresAt);
  await requireEscalaCapability(actor, "export.integration");
  const common = { selectionVersion: 2 as const, manifestId, expiresAt: expiresAt.toISOString(), selectionDigest: snapshot.selectionDigest,
    counts: snapshot.counts, omissions: snapshot.omissions, blockers: snapshot.blockers };
  return snapshot.request.mode === "CATALOG"
    ? { ...common, mode: "CATALOG", context: snapshot.request, rows: snapshot.rows as TurnoCatalogEntryDto[], formats: ["TXT2"] }
    : { ...common, mode: "EMPLOYEES", context: snapshot.request, rows: snapshot.rows as TurnoEmployeeExportLine[], formats: ["TXT1", "TXT2"] };
}

export async function downloadTurnoSelection(actor: EscalaActor, payload: TurnoSelectionPayload, format: "TXT1" | "TXT2", acceptOmissions: boolean) {
  const snapshot = await selectionSnapshot(actor, payload.request);
  if (snapshot.selectionDigest !== payload.selectionDigest) return error("TURNO_MANIFEST_STALE", "O recorte mudou. Confira a seleção novamente.", 409);
  if (snapshot.request.mode === "CATALOG" && format !== "TXT2") return error("TURNO_FORMAT_FORBIDDEN", "Turnos cadastrados geram somente TXT2.");
  if (snapshot.blockers.length) return error("TURNO_EXPORT_BLOCKED", "Corrija as matrículas repetidas antes de preparar qualquer arquivo.", 409);
  if (!snapshot.rows.length) return error("TURNO_EXPORT_EMPTY", "Não há linhas válidas nesta seleção.", 409);
  if (snapshot.omissions.length && !acceptOmissions) return error("TURNO_EXPORT_OMISSIONS", "Confira as pessoas omitidas e confirme o arquivo parcial.", 409);
  const rows = snapshot.rows.map(row => ({ ...row, registration: "registration" in row ? row.registration : "" }));
  const bytes = renderTurnoTxt(format, rows);
  await requireEscalaCapability(actor, "export.integration");
  return { bytes, omissions: snapshot.omissions, month: snapshot.request.month, year: snapshot.request.year };
}
