import { isAdministrativeEscalaSector } from "@/lib/escalas/eligibility";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoCatalogEntryDto } from "@/lib/escalas/shift-catalog/contracts";
import type { TurnoFlowFilters, TurnoSelectionManifestDto, TurnoSelectionManifestRequest } from "@/lib/escalas/shift-catalog/flow-contracts";
import { turnoSelectionManifestSchema } from "@/lib/escalas/shift-catalog/flow-contracts";
import { employeeReferenceShiftChoices } from "@/lib/escalas/shift-catalog/reference-choices";
import { clockMinutes, markingKey, markingsFromShift, renderTurnoTxt } from "@/lib/escalas/shift-catalog/domain";
import { planPeriod } from "../plan-selector";

export const personKey = (value: { workspaceId: string; employeeId: string }) => JSON.stringify([value.workspaceId, value.employeeId]);
export const sectorKey = (value: { workspaceId: string; value: string }) => JSON.stringify([value.workspaceId, value.value]);
export const emptyFilters = (): TurnoFlowFilters => ({ branchCodes: [], employeeKeys: [], sectors: [], catalogCodes: [], registrations: [] });
export function validClockRow(value: unknown): value is Pick<TurnoCatalogEntryDto, "code" | "markings"> {
  return Boolean(value && typeof value === "object" && "code" in value && typeof value.code === "number" && Number.isInteger(value.code) && value.code >= 1500 && value.code <= 2_147_483_647
    && "markings" in value && Array.isArray(value.markings) && value.markings.length === 4 && value.markings.every((mark: unknown) => typeof mark === "string" && clockMinutes(mark) !== null));
}
export function validCatalogEntry(value: unknown): value is TurnoCatalogEntryDto {
  return validClockRow(value) && "name" in value && typeof value.name === "string";
}
export type PersonReference = { shiftId: string; label: string; source: "BASE" | "MANUAL" | "WORK"; code: number | null; problem: string | null };
export type FlowPerson = { key: string; workspaceId: string; employeeId: string; branchCode: string; branchName: string; name: string; registration: string; sector: string; references: PersonReference[]; referenceProblem: "MISSING" | "UNTIMED" | "NO_REFERENCE" };

export function flowPeople(workspaces: readonly EscalaWorkspace[], entries: readonly TurnoCatalogEntryDto[]): FlowPerson[] {
  const codes = new Map(entries.map(entry => [markingKey(entry.markings), entry.code]));
  return workspaces.flatMap(workspace => {
    const month = planPeriod(workspace).key, start = month + "-01";
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    return workspace.input.employees.filter(person => !isAdministrativeEscalaSector(person.sector)
      && person.activeFrom <= end && (!person.activeUntil || person.activeUntil >= start)).map(person => {
      const references = employeeReferenceShiftChoices(workspace.input, person).map(choice => {
        const shift = workspace.input.shifts.find(item => item.id === choice.shiftId);
        const marks = shift && markingsFromShift(shift);
        return { ...choice, code: marks?.ok ? codes.get(markingKey(marks.markings)) ?? null : null, problem: marks?.ok ? null : marks?.reason ?? "STALE_REFERENCE" };
      });
      return { key: personKey({ workspaceId: workspace.id, employeeId: person.id }), workspaceId: workspace.id, employeeId: person.id,
        branchCode: planPeriod(workspace).branch, branchName: workspace.input.branchName, name: person.name, registration: person.registration, sector: person.sector, references, referenceProblem: person.scheduleMode === "MISSING" ? "MISSING" as const : person.scheduleMode === "UNTIMED" ? "UNTIMED" as const : "NO_REFERENCE" as const };
    });
  }).sort((a, b) => a.branchCode.localeCompare(b.branchCode) || a.name.localeCompare(b.name, "pt-BR") || a.key.localeCompare(b.key));
}

export function filterPeople(people: readonly FlowPerson[], filters: TurnoFlowFilters): FlowPerson[] {
  return people.filter(person => (!filters.branchCodes.length || filters.branchCodes.includes(person.branchCode))
    && (!filters.employeeKeys.length || filters.employeeKeys.some(key => personKey(key) === person.key))
    && (!filters.sectors.length || filters.sectors.some(key => key.workspaceId === person.workspaceId && key.value === person.sector))
    && (!filters.registrations.length || filters.registrations.includes(person.registration))
    && (!filters.catalogCodes.length || person.references.some(reference => reference.code !== null && filters.catalogCodes.includes(reference.code))));
}

export function filteredCatalog(entries: readonly TurnoCatalogEntryDto[], people: readonly FlowPerson[], filters: TurnoFlowFilters, scope: "ALL" | "USED"): TurnoCatalogEntryDto[] {
  const used = new Set(filterPeople(people, filters).flatMap(person => person.references.flatMap(ref => ref.code === null ? [] : [ref.code])));
  return entries.filter(entry => (scope === "ALL" || used.has(entry.code)) && (!filters.catalogCodes.length || filters.catalogCodes.includes(entry.code)));
}

export function intersectSelection(selected: readonly string[], available: readonly string[]): string[] {
  const known = new Set(available); return selected.filter(key => known.has(key));
}

export function chosenReference(person: FlowPerson, choices: Readonly<Record<string, string>>, filters: TurnoFlowFilters): string | null {
  const id = person.references.length === 1 ? person.references[0].shiftId : choices[person.key];
  const ref = person.references.find(item => item.shiftId === id);
  return ref && (!filters.catalogCodes.length || ref.code !== null && filters.catalogCodes.includes(ref.code)) ? ref.shiftId : null;
}

export function selectionRequest(mode: "CATALOG" | "EMPLOYEES", scope: "ALL" | "USED", period: string, workspaces: readonly EscalaWorkspace[], entries: readonly TurnoCatalogEntryDto[], filters: TurnoFlowFilters, selected: readonly string[], choices: Readonly<Record<string, string>>): TurnoSelectionManifestRequest {
  const people = filterPeople(flowPeople(workspaces, entries), filters);
  const sources = mode === "CATALOG" && scope === "ALL" ? [] : workspaces.map(item => ({ workspaceId: item.id, revision: item.revision }));
  const base = { selectionVersion: 2 as const, year: Number(period.slice(0, 4)), month: Number(period.slice(5)), filters, sources };
  let request: TurnoSelectionManifestRequest;
  if (mode === "CATALOG") {
    const valid = new Set(filteredCatalog(entries, people, filters, scope).map(item => String(item.code)));
    if (selected.some(key => !valid.has(key))) throw new Error("A seleção de turnos mudou. Confira os filtros novamente.");
    request = { ...base, mode, scope, codes: selected.map(Number) };
  } else {
    const selectedPeople = selected.map(key => people.find(person => person.key === key));
    if (selectedPeople.some(person => !person)) throw new Error("Uma pessoa selecionada não pertence mais ao recorte. Confira novamente.");
    request = { ...base, mode, members: selectedPeople.flatMap(person => person ? [{ workspaceId: person.workspaceId, employeeId: person.employeeId, localShiftId: chosenReference(person, choices, filters) }] : []) };
  }
  const parsed = turnoSelectionManifestSchema.safeParse(request);
  if (!parsed.success) throw new Error("Selecione itens válidos e respeite os limites: até 50 fontes, 250 pessoas por fonte, 1.000 pessoas ou 5.000 códigos por arquivo.");
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > 512 * 1024) throw new Error("A seleção excede o tamanho aceito para uma conferência. Reduza o recorte e tente novamente.");
  return parsed.data;
}

export function intentKey(request: TurnoSelectionManifestRequest): string {
  const sorted = <T>(values: readonly T[]) => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const filters = { branchCodes: sorted(request.filters.branchCodes), employeeKeys: sorted(request.filters.employeeKeys.map(({ workspaceId, employeeId }) => ({ workspaceId, employeeId }))), sectors: sorted(request.filters.sectors.map(({ workspaceId, value }) => ({ workspaceId, value }))), catalogCodes: sorted(request.filters.catalogCodes), registrations: sorted(request.filters.registrations) };
  return JSON.stringify({ selectionVersion: 2, mode: request.mode, scope: request.mode === "CATALOG" ? request.scope : null, year: request.year, month: request.month, sources: sorted(request.sources.map(({ workspaceId, revision }) => ({ workspaceId, revision }))), filters,
    selection: request.mode === "CATALOG" ? sorted(request.codes) : sorted(request.members.map(({ workspaceId, employeeId, localShiftId }) => ({ workspaceId, employeeId, localShiftId }))) });
}

export function confirmManifest(manifest: TurnoSelectionManifestDto, request: TurnoSelectionManifestRequest, catalogue?: readonly TurnoCatalogEntryDto[]): TurnoSelectionManifestDto {
  const context = turnoSelectionManifestSchema.safeParse(manifest?.context);
  if (!context.success || manifest.selectionVersion !== 2 || manifest.mode !== request.mode || intentKey(context.data) !== intentKey(request)
    || typeof manifest.manifestId !== "string" || !manifest.manifestId || typeof manifest.selectionDigest !== "string" || !manifest.selectionDigest.trim() || !(Date.parse(manifest.expiresAt) > Date.now())
    || !Array.isArray(manifest.rows) || !Array.isArray(manifest.omissions) || !Array.isArray(manifest.blockers) || !Array.isArray(manifest.formats)
    || manifest.counts?.selected !== (request.mode === "CATALOG" ? request.codes.length : request.members.length)) throw new Error("A conferência recebida não corresponde à seleção atual. Confira novamente.");
  const expectedFormats = request.mode === "CATALOG" ? ["TXT2"] : ["TXT1", "TXT2"];
  if (JSON.stringify(manifest.formats) !== JSON.stringify(expectedFormats)) throw new Error("Os formatos da conferência não foram confirmados.");
  const countKeys = ["found", "selected", "includedEmployees", "includedCodes", "txt1Lines", "txt2Lines", "omitted", "blockers"] as const;
  if (countKeys.some(key => !Number.isInteger(manifest.counts[key]) || manifest.counts[key] < 0) || manifest.counts.found < manifest.counts.selected
    || manifest.omissions.some(item => !item || typeof item.workspaceId !== "string" || typeof item.employeeId !== "string" || typeof item.registration !== "string" || !Object.hasOwn(omissionLabels, item.reason))
    || manifest.blockers.some(item => item?.reason !== "DUPLICATE_REGISTRATION" || !Array.isArray(item.members) || !item.members.length || typeof item.message !== "string" || item.members.some(member => typeof member?.workspaceId !== "string" || typeof member.employeeId !== "string"))) throw new Error("As pendências e quantidades da conferência não foram confirmadas.");
  const tupleByCode = new Map<number, string>();
  for (const row of manifest.rows) {
    if (!validClockRow(row) || manifest.mode === "CATALOG" && !validCatalogEntry(row)) throw new Error("A conferência contém uma linha de turno inválida.");
    const tuple = markingKey(row.markings), known = catalogue?.find(entry => entry.code === row.code);
    if (tupleByCode.has(row.code) && tupleByCode.get(row.code) !== tuple || catalogue && (!known || markingKey(known.markings) !== tuple)) throw new Error("Um código da conferência não corresponde às marcações consultadas. Atualize e confira novamente.");
    tupleByCode.set(row.code, tuple);
  }
  const codes = new Set(manifest.rows.map(row => row.code));
  if (manifest.counts.includedCodes !== codes.size || manifest.counts.txt2Lines !== codes.size || manifest.counts.omitted !== manifest.omissions.length || manifest.counts.blockers !== manifest.blockers.length) throw new Error("As quantidades da conferência não foram confirmadas.");
  if (manifest.mode === "CATALOG") {
    if (request.mode !== "CATALOG" || manifest.counts.txt1Lines !== 0 || manifest.counts.includedEmployees !== 0 || manifest.rows.length !== request.codes.length || manifest.rows.some(row => !request.codes.includes(row.code)) || codes.size !== manifest.rows.length) throw new Error("As definições da conferência não correspondem à seleção.");
  } else {
    if (request.mode !== "EMPLOYEES" || manifest.counts.txt1Lines !== manifest.rows.length || manifest.counts.includedEmployees !== manifest.rows.length) throw new Error("As pessoas da conferência não foram confirmadas.");
    const members = new Map(request.members.map(member => [personKey(member), member]));
    const rowKeys = manifest.rows.map(personKey), omittedKeys = manifest.omissions.map(personKey);
    const blockedKeys = manifest.blockers.flatMap(blocker => blocker.members.map(personKey));
    const represented = [...rowKeys, ...omittedKeys, ...blockedKeys];
    if (new Set(represented).size !== members.size || represented.some(key => !members.has(key)) || new Set(rowKeys).size !== rowKeys.length || rowKeys.some(key => omittedKeys.includes(key) || blockedKeys.includes(key))
      || new Set(manifest.rows.map(row => row.registration)).size !== manifest.rows.length || manifest.rows.some(row => !row.registration || members.get(personKey(row))?.localShiftId !== row.localShiftId)) throw new Error("A conferência incluiu ou retirou pessoas fora da seleção ou contém matrícula duplicada.");
  }
  return manifest;
}

export function expectedBytes(manifest: TurnoSelectionManifestDto, format: "TXT1" | "TXT2"): Uint8Array {
  if (!manifest.formats.some(value => value === format)) throw new Error("Este formato não pertence à conferência.");
  return renderTurnoTxt(format, manifest.mode === "EMPLOYEES" ? manifest.rows : manifest.rows.map(row => ({ ...row, registration: "" })));
}

export const omissionLabels: Record<string, string> = { NO_REFERENCE: "Sem referência selecionada", MISSING: "Horário não informado", UNTIMED: "Sem horário fixo", CATALOG_REQUIRED: "Turno ainda não cadastrado", ZERO_MARKINGS: "Marcações zeradas", PARTIAL: "Horário incompleto", OVERNIGHT: "Horário no dia seguinte: formato não comporta", PAID_BREAK: "Pausa remunerada: formato não comporta", TOO_MANY_PERIODS: "Mais períodos que o formato aceita", DUPLICATE_REGISTRATION: "Matrícula duplicada", REGISTRATION_MISSING: "Matrícula não informada", STALE_REFERENCE: "Referência indisponível nesta revisão", AMBIGUOUS_REFERENCE: "Escolha uma das referências" };
