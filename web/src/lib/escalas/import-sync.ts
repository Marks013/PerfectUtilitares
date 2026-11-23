import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { EscalaError, requireEscalaCapability, type EscalaActor } from "./access";
import { loadEscalaApproval } from "./approved-policy-service";
import { applyLocalHolidayCalendar } from "./calendar";
import { preserveCalendarSourceContext } from "./calendar-upgrade";
import { importAbsenceApprovalView } from "./draft-save-policy";
import { previewEscalaImport } from "./import";
import { previewFphi105Import } from "./fphi105";
import { generationScenarioBasis } from "./hours-reference";
import { assertEscalaOperationalInput, stableEscalaJson } from "./operational-input-policy";
import { ESCALA_CAPABILITIES } from "./permissions";
import { getEscala, parseEscalaInput, saveEscala } from "./service";
import { manualAssignmentIssues, manualShiftAt, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
import { importSyncCommandSchema, isImportSyncFileSizeAllowed, type ImportSyncCommand, type ImportSyncApplyResult, type ImportSyncPreview,
  type ImportSyncProblem, type ImportSyncPersonChange } from "./import-sync-contracts";
import type { EscalaAssignment, EscalaEmployee, EscalaWorkspace } from "./types";

export type ImportSyncFile = { buffer: Buffer; extension: "csv" | "xlsx" };
type Current = EscalaWorkspace & { approvedPolicyVersionId: string | null };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const key = (day: EscalaAssignment) => `${day.employeeId}\0${day.date}`;
const same = (a: unknown, b: unknown) => stableEscalaJson(a) === stableEscalaJson(b);
const eligible = (person: EscalaEmployee, start: string, end: string) => (!person.activeFrom || person.activeFrom <= end) && (!person.activeUntil || person.activeUntil >= start);
const personChange = (person: EscalaEmployee, fields: string[] = []): ImportSyncPersonChange => ({ id: person.id, registration: person.registration, name: person.name, fields });
const identityName = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();
const numericRegistration = (value: string) => /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : null;

async function reconcile(actor: EscalaActor, command: ImportSyncCommand, file: ImportSyncFile, current: Current, db: Prisma.TransactionClient = prisma) {
  const authority = await requireEscalaCapability(actor, "import.manage", undefined, db);
  await requireEscalaCapability(actor, "workspace.save", current.input.branchCode, db);
  if (!actor.admin) throw new EscalaError(403, "ESCALA_IMPORT_ADMIN_REQUIRED", "A substituição exige acesso administrativo.");
  if (current.revision !== command.expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A proposta mudou. Refaça a conferência.");
  if (current.status === "PUBLISHED") throw new EscalaError(409, "ESCALA_REOPEN_REQUIRED", "Reabra a publicação como rascunho antes de importar.");
  if (!isImportSyncFileSizeAllowed(file.buffer.length) || !["csv", "xlsx"].includes(file.extension)) throw new EscalaError(400, "ESCALA_IMPORT_FILE", "Envie um CSV ou XLSX de até 512 KB.");
  const input = current.input, candidate = structuredClone(input);
  const calendar = applyLocalHolidayCalendar(input).policy;
  const confirmedManualDays = new Set<string>();
  const blockers: ImportSyncProblem[] = [], warnings: ImportSyncPreview["warnings"] = [];
  const block = (code: ImportSyncProblem["code"], message: string, extra: Partial<ImportSyncProblem> = {}) => blockers.push({ code, message, ...extra });
  const impact: ImportSyncPreview["impact"] = { people: { added: [], updated: [], removed: [], unchanged: [] }, absences: { added: [], removed: [], unchanged: [] }, assignments: [], references: [] };
  const corrections = new Map((command.registrationCorrections ?? []).map(row => [row.line, row.registration]));
  let missingRegistrations: ImportSyncPreview["missingRegistrations"];
  let layout: ImportSyncPreview["layout"] = "UNRECOGNIZED", sourcePeriod: ImportSyncPreview["coverage"]["sourcePeriod"] = null;
  if (!command.completeScopeConfirmed) block("COVERAGE_UNCONFIRMED", "Confirme que o arquivo cobre integralmente a filial e o intervalo informado.");
  if (command.startDate < input.startDate || command.endDate > input.endDate || (command.purpose === "EMPLOYEES" && (command.startDate !== input.startDate || command.endDate !== input.endDate))) block("SCOPE_MISMATCH", "O intervalo não corresponde ao universo substituível desta proposta.");
  let approvalState: unknown = null;
  if (current.approvedPolicyVersionId) {
    try {
      const approved = await loadEscalaApproval(actor, current.approvedPolicyVersionId, db, input);
      approvalState = { id: approved.row.id, hash: approved.row.snapshotHash, version: approved.row.version };
    } catch (error) {
      if (!(error instanceof EscalaError)) throw error;
      block("APPROVAL_UNAVAILABLE", "A aprovação atual não pôde ser conferida. Resolva a referência administrativa.");
    }
  }
  if (command.purpose === "EMPLOYEES") {
    try {
      const source = await previewEscalaImport(file.buffer, file.extension, { branchCode: input.branchCode, startDate: input.startDate, defaultWeeklyHours: input.defaultWeeklyHours, registrationCorrections: corrections, onLayoutRecognized: recognized => { layout = recognized; } });
      layout = source.report ? "FPRE136" : "ESCALA_TEMPLATE";
      missingRegistrations = source.replacement?.missingRegistrations;
      const correctedLines = new Map<string, number>();
      const sourceMissing = new Set(missingRegistrations?.map(row => row.line));
      let unresolvedIdentity = false;
      for (const row of missingRegistrations ?? []) {
        const registration = corrections.get(row.line);
        if (row.resolved && registration) correctedLines.set(registration, row.line);
        else {
          unresolvedIdentity = true;
          block("SOURCE_IDENTITY", registration ? "Informe a matrícula do FPRE136 somente com dígitos, incluindo os zeros à esquerda." : "Informe a matrícula antes de confirmar a substituição.", { line: row.line });
        }
      }
      for (const line of corrections.keys()) if (!sourceMissing.has(line)) {
        unresolvedIdentity = true;
        block("SOURCE_IDENTITY", "Esta linha não está sem matrícula no arquivo da filial selecionada.", { line });
      }
      const rejected = source.issues.filter(issue => issue.rejected);
      if (rejected.some(issue => sourceMissing.has(issue.line))) unresolvedIdentity = true;
      if (!source.replacement || source.replacement.rejectedRows > rejected.length)
        block("SOURCE_PARTIAL", "Há trechos não reconhecidos. Exporte novamente o arquivo completo.");
      for (const issue of source.replacement?.paginationIssues ?? []) block("SOURCE_PARTIAL", issue.message, { line: issue.line });
      if (source.replacement?.invalidIdentityRows) block("SOURCE_IDENTITY", "A matrícula deve estar preservada como texto na origem.");
      if (!source.employees.length && !unresolvedIdentity) block("EMPTY_SOURCE", "Nenhum colaborador válido: a equipe não será apagada.");
      for (const issue of source.issues) {
        if (issue.rejected) block("SOURCE_PARTIAL", issue.message, { line: issue.line });
        else warnings.push({ code: "SOURCE_WARNING", message: issue.message, line: issue.line });
      }
      const matched = new Set<string>(), seen = new Set<string>();
      const outside = input.employees.filter(person => !eligible(person, command.startDate, command.endDate));
      const replacements: EscalaEmployee[] = [];
      const registrations = new Set([...input.employees, ...source.employees].map(person => person.registration));
      let unknownAdmissions = 0;
      for (const row of source.employees) {
        const correctedLine = correctedLines.get(row.registration);
        const numeric = correctedLine === undefined ? null : numericRegistration(row.registration);
        if (numeric !== null && [...registrations].some(other => other !== row.registration && numericRegistration(other) === numeric)) {
          unresolvedIdentity = true;
          block("SOURCE_IDENTITY", "Há uma matrícula com zeros à esquerda diferente da informada. Use a matrícula completa, exatamente como consta no cadastro oficial.", { line: correctedLine });
          continue;
        }
        if (seen.has(row.registration)) { block("DUPLICATE_REGISTRATION", "Há matrícula repetida no arquivo."); continue; }
        seen.add(row.registration);
        if (!eligible(row, command.startDate, command.endDate)) {
          const inScope = input.employees.find(person => person.registration === row.registration && eligible(person, command.startDate, command.endDate));
          if (correctedLine !== undefined) {
            unresolvedIdentity = true;
            block("OUTSIDE_BINDING", "O vínculo da linha com matrícula informada está fora do período. Confira os dados da fonte.", { line: correctedLine });
          } else if (inScope) block("OUTSIDE_BINDING", "O vínculo da fonte diverge do vínculo atual.", { employeeId: inScope.id });
          else warnings.push({ code: "OUTSIDE_SCOPE", message: "Um vínculo da fonte está fora do intervalo informado." });
          continue;
        }
        const matches = input.employees.filter(person => person.registration === row.registration && eligible(person, command.startDate, command.endDate));
        if (matches.length > 1) {
          if (correctedLine !== undefined) unresolvedIdentity = true;
          block("AMBIGUOUS_REGISTRATION", "Há mais de um vínculo possível para a matrícula.", { line: correctedLine });
          continue;
        }
        const old = matches[0];
        if (!old && outside.some(person => person.registration === row.registration)) {
          if (correctedLine !== undefined) unresolvedIdentity = true;
          block("AMBIGUOUS_REGISTRATION", "O arquivo não permite confirmar um novo vínculo para a matrícula.", { line: correctedLine });
          continue;
        }
        if (correctedLine !== undefined && old && identityName(old.name) !== identityName(row.name)) {
          unresolvedIdentity = true;
          block("SOURCE_IDENTITY", "A matrícula informada já pertence a um cadastro com outro nome. Confira a identificação no arquivo oficial.", { line: correctedLine });
          continue;
        }
        const next: EscalaEmployee = old ? structuredClone(old) : { ...row, id: `imp-sync-${hash(`${actor.tenantId}\0${current.id}\0${row.registration}\0${row.activeFrom}`).slice(0, 24)}` };
        if (!old && input.employees.some(person => person.id === next.id)) { block("ID_CONFLICT", "A identificação do novo vínculo colide com um registro atual."); continue; }
        const fields = source.replacement?.fieldsById[row.id] ?? [];
        const mappedIds = row.shiftIds.map(id => {
          const definition = source.shifts.find(shift => shift.id === id);
          if (!definition) { block("INVALID_CANDIDATE", "Há referência de horário ausente."); return id; }
          const collision = candidate.shifts.find(shift => shift.id === id);
          if (collision && !same(collision.segments, definition.segments)) block("ID_CONFLICT", "A identificação do horário tem marcações diferentes.");
          const identical = candidate.shifts.find(shift => (old?.manualShiftBaseIds ?? old?.shiftIds ?? []).includes(shift.id) && same(shift.segments, definition.segments))
            ?? candidate.shifts.find(shift => same(shift.segments, definition.segments));
          if (identical) return identical.id;
          if (!collision) candidate.shifts.push(definition);
          return id;
        });
        for (const field of fields) {
          if (field === "scheduleMode" && old?.scheduleMode === undefined && !row.scheduleMode) continue;
          Object.assign(next, { [field]: field === "shiftIds" ? mappedIds : field === "scheduleMode" ? row.scheduleMode ?? "TIMED" : row[field as keyof EscalaEmployee] });
        }
        const unchangedBase = same(old?.manualShiftBaseIds ?? old?.shiftIds, mappedIds);
        if (!source.report && !unchangedBase) delete next.sourceSchedule;
        if (old?.manualShiftOverrides?.length) {
          if (next.scheduleMode === "UNTIMED" || next.scheduleMode === "MISSING") block("MANUAL_REFERENCE_CONFLICT", "A referência importada conflita com uma escolha manual.", { employeeId: old.id });
          if (unchangedBase) next.shiftIds = old.shiftIds;
          else { next.manualShiftBaseIds = mappedIds; delete next.manualShiftByDate; }
        }
        if (old) {
          matched.add(old.id);
          const changed = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(field => !same(old[field as keyof EscalaEmployee], next[field as keyof EscalaEmployee])).sort();
          impact.people[changed.length ? "updated" : "unchanged"].push(personChange(next, changed));
          if (!same(old.sourceSchedule, next.sourceSchedule) || !same(old.shiftIds, next.shiftIds) || old.scheduleMode !== next.scheduleMode) impact.references.push({ employeeId: old.id, registration: old.registration, before: stableEscalaJson({ shiftIds: old.shiftIds, source: old.sourceSchedule, mode: old.scheduleMode }), after: stableEscalaJson({ shiftIds: next.shiftIds, source: next.sourceSchedule, mode: next.scheduleMode }) });
        } else impact.people.added.push(personChange(next, fields));
        if (!next.activeFrom) unknownAdmissions++;
        replacements.push(next);
      }
      if (unknownAdmissions) warnings.push({ code: "UNKNOWN_BINDING", message: `O FPRE136 não informa admissão. Vínculos sem data no cadastro: ${unknownAdmissions}. As admissões já cadastradas são preservadas.` });
      if (!replacements.length && !unresolvedIdentity) block("EMPTY_SOURCE", "Não há vínculos aplicáveis; nenhuma remoção será confirmada.");
      const removed = unresolvedIdentity ? [] : input.employees.filter(person => eligible(person, command.startDate, command.endDate) && !matched.has(person.id));
      const retained = unresolvedIdentity ? input.employees.filter(person => !matched.has(person.id)) : outside;
      impact.people.removed = removed.map(person => personChange(person));
      impact.people.unchanged.push(...retained.map(person => personChange(person)));
      const removedIds = new Set(removed.map(person => person.id));
      const calendarDays = new Set([...calendar.holidayDates, ...calendar.closedDates]);
      for (const day of input.assignments) if (removedIds.has(day.employeeId)) {
        const target = { employeeId: day.employeeId, date: day.date };
        if (day.locked === true) block("PROTECTED_ASSIGNMENT", "A saída atingiria um dia bloqueado explicitamente. Confira o bloqueio no rascunho.", target);
        else if (day.absenceSource === "MANUAL") block("PROTECTED_ASSIGNMENT", "A saída atingiria um afastamento lançado manualmente. Confira o lançamento antes de substituir a equipe.", target);
        else if (day.kind === "HOLIDAY" && !calendarDays.has(day.date)) block("PROTECTED_ASSIGNMENT", "A saída atingiria um feriado que não consta no calendário. Confira o rascunho.", target);
      }
      for (const person of removed) if (person.manualShiftOverrides?.length) block("MANUAL_REFERENCE_CONFLICT", "A pessoa que sairia da equipe tem um horário selecionado manualmente. Confira a seleção antes de substituir.", { employeeId: person.id });
      candidate.employees = [...retained, ...replacements];
      candidate.assignments = input.assignments.filter(day => !removedIds.has(day.employeeId));
    } catch (error) {
      if (!(error instanceof EscalaError) && !(error instanceof Error)) throw error;
      block("SOURCE_INVALID", "Não foi possível interpretar integralmente o arquivo de equipe.");
    }
  } else {
    try {
      if (file.extension !== "csv") throw new EscalaError(400, "ESCALA_ABSENCE_LAYOUT", "Envie FPHI105 em CSV.");
      const source = previewFphi105Import(file.buffer, { branchCode: input.branchCode, startDate: command.startDate, endDate: command.endDate, employees: input.employees, onLayoutRecognized: recognized => { layout = recognized; } });
      layout = "FPHI105"; sourcePeriod = source.reportPeriod ?? null;
      if (!sourcePeriod || sourcePeriod.startDate > command.startDate || sourcePeriod.endDate < command.endDate || source.issues.some(issue => issue.code === "REPORT_PERIOD_CONFLICT")) block("SOURCE_PERIOD", "O período do relatório não comprova a cobertura solicitada.");
      if (!source.replacement || source.replacement.unrecognizedRows) block("SOURCE_PARTIAL", "Há linhas não reconhecidas. Exporte novamente o FPHI105 completo.");
      for (const match of source.replacement?.numericMatches ?? []) warnings.push({ code: "NUMERIC_REGISTRATION_MATCH", message: "Correspondência numérica de legado: confira a matrícula preservada.", ...match });
      for (const issue of source.issues) {
        if (issue.code === "INVALID_COLUMNS" || issue.code === "INVALID_ABSENCE" || issue.code === "UNMATCHED_REGISTRATION" || issue.code === "AMBIGUOUS_REGISTRATION")
          block("SOURCE_PARTIAL", issue.message, { line: issue.line });
        else if (issue.code !== "REPORT_PERIOD_CONFLICT" && issue.code !== "NO_ABSENCE_ROWS")
          warnings.push({ code: "SOURCE_WARNING", message: issue.message, line: issue.line });
      }
      const existing = new Map(input.assignments.map(day => [key(day), day]));
      const incoming = new Map<string, EscalaAssignment>();
      const employees = new Map(input.employees.map(person => [person.id, person]));
      const closedDates = new Set(calendar.closedDates);
      const holidayDates = new Set(calendar.holidayDates);
      let skippedCalendarDays = 0;
      for (const day of source.assignments) {
        const person = employees.get(day.employeeId);
        if (!person || !eligible(person, day.date, day.date)) block("OUTSIDE_BINDING", "O afastamento está fora do vínculo canônico.", { employeeId: day.employeeId, date: day.date });
        const old = existing.get(key(day));
        if (old?.kind !== "ABSENCE") {
          const officialHoliday = old?.kind === "HOLIDAY" && (holidayDates.has(day.date) || closedDates.has(day.date));
          if ((person && manualShiftAt(person, day.date)) || (!officialHoliday && (old?.locked === true || old?.kind === "HOLIDAY"))) {
            block("PROTECTED_ASSIGNMENT", "O afastamento conflita com um bloqueio, ajuste manual ou feriado fora do calendário.", { employeeId: day.employeeId, date: day.date });
          } else if (closedDates.has(day.date) || officialHoliday) {
            skippedCalendarDays++;
            continue;
          }
        }
        incoming.set(key(day), day);
      }
      if (skippedCalendarDays) warnings.push({ code: "SOURCE_WARNING", message: `Foram preservados ${skippedCalendarDays} dia(s) de feriado ou fechamento. O afastamento considera os demais dias do intervalo.` });
      if (!incoming.size) {
        block("EMPTY_SOURCE", "Nenhum dia de afastamento aplicável. Nenhum registro será removido.");
      } else {
        candidate.assignments = input.assignments.filter(day => !(day.kind === "ABSENCE" && day.date >= command.startDate && day.date <= command.endDate) && !incoming.has(key(day)));
        for (const [id, day] of incoming) {
          const old = existing.get(id);
          if (old?.kind === "ABSENCE" && old.absenceSource === "MANUAL") {
            const { absenceSource: _manual, ...imported } = old;
            candidate.assignments.push(imported);
            confirmedManualDays.add(id);
          } else candidate.assignments.push(old?.kind === "ABSENCE" ? old : day);
        }
      }
      if (confirmedManualDays.size) warnings.push({ code: "SOURCE_WARNING", message: `A importação confirma ${confirmedManualDays.size} dia(s) lançado(s) manualmente. Após a substituição, esses dias terão origem na importação e só poderão ser alterados pela administração.` });
      impact.people.unchanged = input.employees.map(person => personChange(person));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      block("SOURCE_INVALID", "Não foi possível interpretar integralmente o relatório de afastamentos.");
    }
  }
  if (candidate.employees.length > 250) block("TOO_MANY_PEOPLE", "O resultado excede 250 colaboradores.");
  candidate.employees.sort((a, b) => a.id.localeCompare(b.id));
  candidate.assignments.sort((a, b) => key(a).localeCompare(key(b)));
  const before = new Map(input.assignments.map(day => [key(day), day])), after = new Map(candidate.assignments.map(day => [key(day), day]));
  const people = new Map([...input.employees, ...candidate.employees].map(person => [person.id, person]));
  let operationalAssignmentChanged = false;
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(id), next = after.get(id), day = next ?? old;
    if (!day) continue;
    const registration = people.get(day.employeeId)?.registration ?? "";
    if (!same(old, next)) {
      if (!confirmedManualDays.has(id)) operationalAssignmentChanged = true;
      impact.assignments.push({ employeeId: day.employeeId, registration, date: day.date, previousKind: old?.kind ?? null, nextKind: next?.kind ?? null, previousShiftId: old?.shiftId ?? null, nextShiftId: next?.shiftId ?? null });
    }
    const fact = { employeeId: day.employeeId, registration, date: day.date };
    if (old?.kind === "ABSENCE" && next?.kind === "ABSENCE") impact.absences.unchanged.push(fact);
    else if (old?.kind === "ABSENCE") impact.absences.removed.push(fact);
    else if (next?.kind === "ABSENCE") impact.absences.added.push(fact);
  }
  const regenerate = generationScenarioBasis(input) !== generationScenarioBasis(candidate) || operationalAssignmentChanged;
  if (regenerate) { candidate.needsRegeneration = true; delete candidate.generationBasis; delete candidate.coverageBasis; }
  let invalidatesApproval = false;
  if (current.approvedPolicyVersionId) {
    // Days explicitly confirmed in the CSV retain their exact operational record. The
    // preview and hash still capture the source change, but it is not a regime change.
    const approvalCandidate = confirmedManualDays.size ? importAbsenceApprovalView(input, candidate, command.startDate, command.endDate) : candidate;
    try { assertEscalaOperationalInput(input, approvalCandidate, ESCALA_CAPABILITIES); }
    catch (error) { if (!(error instanceof EscalaError) || error.code !== "ESCALA_PROTECTED_INPUT") throw error; invalidatesApproval = true; }
  }
  let parsed = candidate;
  try {
    parsed = materializeManualShiftOverrides(parseEscalaInput(candidate));
    preserveCalendarSourceContext(input, parsed);
    if (manualShiftIssues(parsed).length || manualAssignmentIssues(parsed).length) block("MANUAL_REFERENCE_CONFLICT", "O resultado exige resolver referências ou atribuições manuais.");
    for (const day of input.assignments) if (day.kind === "WORK" && day.locked === true) {
      const person = parsed.employees.find(person => person.id === day.employeeId);
      if (person && !person.shiftIds.includes(day.shiftId ?? "") && person.manualShiftByDate?.[day.date] !== day.shiftId) block("PROTECTED_ASSIGNMENT", "A referência importada retiraria o horário de um trabalho protegido.", { employeeId: day.employeeId, date: day.date });
    }
  } catch (error) {
    if (error instanceof EscalaError && error.code === "ESCALA_CALENDAR_BOUNDARY_CONFLICT") block("PROTECTED_ASSIGNMENT", error.message);
    else block("INVALID_CANDIDATE", "O resultado da substituição não passou pela validação da proposta.");
  }
  const noChanges = command.purpose === "EMPLOYEES" && blockers.length === 0
    && impact.people.added.length + impact.people.updated.length + impact.people.removed.length + impact.assignments.length + impact.references.length === 0
    && same(input.shifts, candidate.shifts);
  for (const list of Object.values(impact.people)) list.sort((a, b) => a.id.localeCompare(b.id));
  const preview: ImportSyncPreview = { contractVersion: 1, purpose: command.purpose, layout,
    context: { workspaceId: current.id, revision: current.revision, branchCode: input.branchCode, workspaceStartDate: input.startDate, workspaceEndDate: input.endDate, visibleMonth: input.visibleMonth ?? null, status: current.status },
    scope: { startDate: command.startDate, endDate: command.endDate },
    coverage: { completeScopeConfirmed: command.completeScopeConfirmed, sourcePeriod, basis: command.purpose === "ABSENCES" ? "REPORT_PERIOD_AND_ADMIN_DECLARATION" : "ADMIN_DECLARATION" },
    fileHash: hash(file.buffer), expectedImpactHash: "", canApply: blockers.length === 0 && !noChanges,
    ...(missingRegistrations?.length ? { missingRegistrations } : {}), impact, blockers, warnings,
    counts: { addedPeople: impact.people.added.length, updatedPeople: impact.people.updated.length, removedPeople: impact.people.removed.length, unchangedPeople: impact.people.unchanged.length, addedAbsenceDays: impact.absences.added.length, removedAbsenceDays: impact.absences.removed.length, unchangedAbsenceDays: impact.absences.unchanged.length, assignmentChanges: impact.assignments.length, blockers: blockers.length },
    effect: { nextStatus: "DRAFT", needsRegeneration: Boolean(noChanges ? input.needsRegeneration : parsed.needsRegeneration), approvalInvalidated: !noChanges && invalidatesApproval,
      ...(noChanges ? { noChanges: true } : {}), approvedPolicyVersionIdBefore: current.approvedPolicyVersionId, approvedPolicyVersionIdAfter: !noChanges && invalidatesApproval ? null : current.approvedPolicyVersionId } };
  preview.expectedImpactHash = hash(stableEscalaJson({ preview, candidate: parsed, authority, approvalState, extension: file.extension,
    ...(corrections.size ? { registrationCorrections: [...corrections].sort(([a], [b]) => a - b) } : {}) }));
  return { preview, candidate: parsed };
}

export async function previewAdminImport(actor: EscalaActor, raw: ImportSyncCommand, file: ImportSyncFile): Promise<ImportSyncPreview> {
  const command = importSyncCommandSchema.parse(raw);
  const current = await getEscala(actor, command.workspaceId) as Current;
  const result = await reconcile(actor, command, file, current);
  await requireEscalaCapability(actor, "import.manage");
  return result.preview;
}

export async function applyAdminImport(actor: EscalaActor, raw: ImportSyncCommand, file: ImportSyncFile): Promise<ImportSyncApplyResult> {
  const command = importSyncCommandSchema.parse(raw);
  if (command.action !== "APPLY_REPLACE") throw new EscalaError(400, "ESCALA_IMPORT_ACTION", "Confirme a substituição pela ação própria.");
  const current = await getEscala(actor, command.workspaceId) as Current;
  const result = await reconcile(actor, command, file, current);
  const check = (preview: ImportSyncPreview) => {
    if (preview.expectedImpactHash !== command.expectedImpactHash) throw new EscalaError(409, "ESCALA_IMPORT_STALE_IMPACT", "O impacto mudou. Refaça a conferência.");
    if (preview.effect.noChanges) throw new EscalaError(422, "ESCALA_IMPORT_NO_CHANGES", "A equipe já está atualizada. Nenhuma alteração foi gravada.");
    if (!preview.canApply) throw new EscalaError(422, "ESCALA_IMPORT_BLOCKED", "Resolva os impedimentos antes de substituir.");
  };
  check(result.preview);
  const workspace = await saveEscala(actor, current.id, command.expectedRevision, result.candidate, false, { adminImport: {
    removedAbsenceKeys: command.purpose === "ABSENCES" ? result.preview.impact.absences.removed.map(day => key({ ...day, kind: "ABSENCE" })) : [], invalidatesApproval: result.preview.effect.approvalInvalidated,
    audit: { purpose: command.purpose, fileHash: result.preview.fileHash, impactHash: result.preview.expectedImpactHash, startDate: command.startDate, endDate: command.endDate, addedPeople: result.preview.counts.addedPeople, removedPeople: result.preview.counts.removedPeople, addedAbsenceDays: result.preview.counts.addedAbsenceDays, removedAbsenceDays: result.preview.counts.removedAbsenceDays },
    verify: async (tx, latest, rawInput) => {
      const row = await tx.escalaWorkspace.findFirst({ where: { id: current.id, tenantId: actor.tenantId, revision: command.expectedRevision }, select: { revision: true } });
      if (!row) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A proposta mudou. Refaça a conferência.");
      const final = await reconcile(actor, command, file, latest, tx);
      check(final.preview);
      if (!same(final.candidate, rawInput)) throw new EscalaError(409, "ESCALA_IMPORT_STALE_IMPACT", "O resultado mudou durante a confirmação.");
    },
  } });
  await requireEscalaCapability(actor, "import.manage");
  return { workspace, summary: result.preview };
}
