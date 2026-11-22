import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { EscalaError, requireEscalaCapability, type EscalaActor } from "./access";
import { loadEscalaApproval } from "./approved-policy-service";
import { previewEscalaImport } from "./import";
import { previewFphi105Import } from "./fphi105";
import { generationScenarioBasis } from "./hours-reference";
import { assertEscalaOperationalInput, stableEscalaJson } from "./operational-input-policy";
import { ESCALA_CAPABILITIES } from "./permissions";
import { getEscala, parseEscalaInput, saveEscala } from "./service";
import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
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

async function reconcile(actor: EscalaActor, command: ImportSyncCommand, file: ImportSyncFile, current: Current, db: Prisma.TransactionClient = prisma) {
  const authority = await requireEscalaCapability(actor, "import.manage", undefined, db);
  await requireEscalaCapability(actor, "workspace.save", current.input.branchCode, db);
  if (!actor.admin) throw new EscalaError(403, "ESCALA_IMPORT_ADMIN_REQUIRED", "A substituição exige acesso administrativo.");
  if (current.revision !== command.expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A proposta mudou. Refaça a conferência.");
  if (!isImportSyncFileSizeAllowed(file.buffer.length) || !["csv", "xlsx"].includes(file.extension)) throw new EscalaError(400, "ESCALA_IMPORT_FILE", "Envie um CSV ou XLSX de até 512 KB.");
  const input = current.input, candidate = structuredClone(input);
  const blockers: ImportSyncProblem[] = [], warnings: ImportSyncPreview["warnings"] = [];
  const block = (code: ImportSyncProblem["code"], message: string, extra: Partial<ImportSyncProblem> = {}) => blockers.push({ code, message, ...extra });
  const impact: ImportSyncPreview["impact"] = { people: { added: [], updated: [], removed: [], unchanged: [] }, absences: { added: [], removed: [], unchanged: [] }, assignments: [], references: [] };
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
      const source = await previewEscalaImport(file.buffer, file.extension, { branchCode: input.branchCode, startDate: input.startDate, defaultWeeklyHours: input.defaultWeeklyHours, onLayoutRecognized: recognized => { layout = recognized; } });
      layout = source.report ? "FPRE136" : "ESCALA_TEMPLATE";
      if (!source.replacement || source.replacement.rejectedRows) block("SOURCE_PARTIAL", "Há linhas rejeitadas. Exporte novamente o arquivo completo.");
      if (source.replacement?.paginationIssues?.length) block("SOURCE_PARTIAL", "A paginação ou o contexto do relatório está incompleto. Exporte novamente o arquivo completo.");
      if (source.replacement?.invalidIdentityRows) block("SOURCE_IDENTITY", "A matrícula deve estar preservada como texto na origem.");
      if (!source.employees.length) block("EMPTY_SOURCE", "Nenhum colaborador válido: a equipe não será apagada.");
      for (const issue of source.issues) warnings.push({ code: "SOURCE_WARNING", message: issue.message, line: issue.line });
      const matched = new Set<string>(), seen = new Set<string>();
      const outside = input.employees.filter(person => !eligible(person, command.startDate, command.endDate));
      const replacements: EscalaEmployee[] = [];
      for (const row of source.employees) {
        if (seen.has(row.registration)) { block("DUPLICATE_REGISTRATION", "Há matrícula repetida no arquivo."); continue; }
        seen.add(row.registration);
        if (!eligible(row, command.startDate, command.endDate)) {
          if (input.employees.some(person => person.registration === row.registration && eligible(person, command.startDate, command.endDate))) block("OUTSIDE_BINDING", "O vínculo da fonte diverge do vínculo atual.");
          warnings.push({ code: "OUTSIDE_SCOPE", message: "Um vínculo da fonte está fora do intervalo informado.", employeeId: row.id }); continue;
        }
        const matches = input.employees.filter(person => person.registration === row.registration && eligible(person, command.startDate, command.endDate));
        if (matches.length > 1) { block("AMBIGUOUS_REGISTRATION", "Há mais de um vínculo possível para a matrícula."); continue; }
        const old = matches[0];
        if (!old && outside.some(person => person.registration === row.registration)) { block("AMBIGUOUS_REGISTRATION", "O arquivo não permite confirmar um novo vínculo para a matrícula."); continue; }
        if (!row.activeFrom && !old?.activeFrom) warnings.push({ code: "UNKNOWN_BINDING", message: "Admissão desconhecida; nenhuma data será fabricada.", employeeId: old?.id ?? row.id });
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
        if (!source.report) delete next.sourceSchedule;
        if (old?.manualShiftOverrides?.length) {
          if (next.scheduleMode === "UNTIMED" || next.scheduleMode === "MISSING") block("MANUAL_REFERENCE_CONFLICT", "A referência importada conflita com uma escolha manual.", { employeeId: old.id });
          next.manualShiftBaseIds = mappedIds; delete next.manualShiftByDate;
        }
        if (old) {
          matched.add(old.id);
          const changed = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(field => !same(old[field as keyof EscalaEmployee], next[field as keyof EscalaEmployee])).sort();
          impact.people[changed.length ? "updated" : "unchanged"].push(personChange(next, changed));
          if (!same(old.sourceSchedule, next.sourceSchedule) || !same(old.shiftIds, next.shiftIds) || old.scheduleMode !== next.scheduleMode) impact.references.push({ employeeId: old.id, registration: old.registration, before: stableEscalaJson({ shiftIds: old.shiftIds, source: old.sourceSchedule, mode: old.scheduleMode }), after: stableEscalaJson({ shiftIds: next.shiftIds, source: next.sourceSchedule, mode: next.scheduleMode }) });
        } else impact.people.added.push(personChange(next, fields));
        replacements.push(next);
      }
      if (!replacements.length) block("EMPTY_SOURCE", "Não há vínculos aplicáveis; nenhuma remoção será confirmada.");
      const removed = input.employees.filter(person => eligible(person, command.startDate, command.endDate) && !matched.has(person.id));
      impact.people.removed = removed.map(person => personChange(person));
      impact.people.unchanged.push(...outside.map(person => personChange(person)));
      const removedIds = new Set(removed.map(person => person.id));
      for (const day of input.assignments) if (removedIds.has(day.employeeId) && (day.kind === "ABSENCE" || day.kind === "HOLIDAY" || day.locked !== false)) block("PROTECTED_ASSIGNMENT", "A remoção atingiria uma atribuição protegida.", { employeeId: day.employeeId, date: day.date });
      candidate.employees = [...outside, ...replacements];
      candidate.assignments = input.assignments.filter(day => !removedIds.has(day.employeeId));
    } catch (error) {
      if (!(error instanceof EscalaError) && !(error instanceof Error)) throw error;
      block("SOURCE_INVALID", "Não foi possível interpretar integralmente o arquivo de equipe.");
    }
  } else {
    try {
      if (file.extension !== "csv") throw new EscalaError(400, "ESCALA_ABSENCE_LAYOUT", "Envie FPHI105 em CSV.");
      const source = previewFphi105Import(file.buffer, { startDate: command.startDate, endDate: command.endDate, employees: input.employees, onLayoutRecognized: recognized => { layout = recognized; } });
      layout = "FPHI105"; sourcePeriod = source.reportPeriod ?? null;
      if (!sourcePeriod || sourcePeriod.startDate > command.startDate || sourcePeriod.endDate < command.endDate || source.issues.some(issue => issue.code === "REPORT_PERIOD_CONFLICT")) block("SOURCE_PERIOD", "O período do relatório não comprova a cobertura solicitada.");
      if (!source.replacement || source.replacement.unrecognizedRows || source.counts.invalidRows || source.counts.unmatchedRows || source.counts.ambiguousRows) block("SOURCE_PARTIAL", "Há linhas incompletas ou sem correspondência inequívoca na equipe.");
      if (!source.assignments.length) block("EMPTY_SOURCE", "Nenhum afastamento válido: a limpeza integral não é suportada.");
      for (const match of source.replacement?.numericMatches ?? []) warnings.push({ code: "NUMERIC_REGISTRATION_MATCH", message: "Correspondência numérica de legado: confira a matrícula preservada.", ...match });
      for (const issue of source.issues) warnings.push({ code: "SOURCE_WARNING", message: issue.message, line: issue.line });
      const existing = new Map(input.assignments.map(day => [key(day), day]));
      const incoming = new Map(source.assignments.map(day => [key(day), day]));
      for (const day of source.assignments) {
        const person = input.employees.find(person => person.id === day.employeeId);
        if (!person || !eligible(person, day.date, day.date)) block("OUTSIDE_BINDING", "O afastamento está fora do vínculo canônico.", { employeeId: day.employeeId, date: day.date });
        if (person && !person.activeFrom) warnings.push({ code: "UNKNOWN_BINDING", message: "Admissão desconhecida; confira o vínculo.", employeeId: person.id });
        const old = existing.get(key(day));
        if (old && old.kind !== "ABSENCE" && (old.kind === "HOLIDAY" || old.locked !== false)) block("PROTECTED_ASSIGNMENT", "O afastamento conflita com uma atribuição protegida.", { employeeId: day.employeeId, date: day.date });
      }
      candidate.assignments = input.assignments.filter(day => !(day.kind === "ABSENCE" && day.date >= command.startDate && day.date <= command.endDate) && !incoming.has(key(day)));
      for (const [id, day] of incoming) candidate.assignments.push(existing.get(id)?.kind === "ABSENCE" ? existing.get(id) as EscalaAssignment : day);
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
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(id), next = after.get(id), day = next ?? old;
    if (!day) continue;
    const registration = people.get(day.employeeId)?.registration ?? "";
    if (!same(old, next)) impact.assignments.push({ employeeId: day.employeeId, registration, date: day.date, previousKind: old?.kind ?? null, nextKind: next?.kind ?? null, previousShiftId: old?.shiftId ?? null, nextShiftId: next?.shiftId ?? null });
    const fact = { employeeId: day.employeeId, registration, date: day.date };
    if (old?.kind === "ABSENCE" && next?.kind === "ABSENCE") impact.absences.unchanged.push(fact);
    else if (old?.kind === "ABSENCE") impact.absences.removed.push(fact);
    else if (next?.kind === "ABSENCE") impact.absences.added.push(fact);
  }
  const regenerate = generationScenarioBasis(input) !== generationScenarioBasis(candidate) || impact.assignments.length > 0;
  if (regenerate) { candidate.needsRegeneration = true; delete candidate.generationBasis; delete candidate.coverageBasis; }
  let invalidatesApproval = false;
  if (current.approvedPolicyVersionId) {
    try { assertEscalaOperationalInput(input, candidate, ESCALA_CAPABILITIES); }
    catch (error) { if (!(error instanceof EscalaError) || error.code !== "ESCALA_PROTECTED_INPUT") throw error; invalidatesApproval = true; }
  }
  let parsed = candidate;
  try {
    parsed = materializeManualShiftOverrides(parseEscalaInput(candidate));
    if (manualShiftIssues(parsed).length || manualAssignmentIssues(parsed).length) block("MANUAL_REFERENCE_CONFLICT", "O resultado exige resolver referências ou atribuições manuais.");
    for (const day of input.assignments) if (day.kind === "WORK" && day.locked !== false) {
      const person = parsed.employees.find(person => person.id === day.employeeId);
      if (person && !person.shiftIds.includes(day.shiftId ?? "") && person.manualShiftByDate?.[day.date] !== day.shiftId) block("PROTECTED_ASSIGNMENT", "A referência importada retiraria o horário de um trabalho protegido.", { employeeId: day.employeeId, date: day.date });
    }
  } catch { block("INVALID_CANDIDATE", "O resultado da substituição não passou pela validação da proposta."); }
  for (const list of Object.values(impact.people)) list.sort((a, b) => a.id.localeCompare(b.id));
  const preview: ImportSyncPreview = { contractVersion: 1, purpose: command.purpose, layout,
    context: { workspaceId: current.id, revision: current.revision, branchCode: input.branchCode, workspaceStartDate: input.startDate, workspaceEndDate: input.endDate, visibleMonth: input.visibleMonth ?? null, status: current.status },
    scope: { startDate: command.startDate, endDate: command.endDate },
    coverage: { completeScopeConfirmed: command.completeScopeConfirmed, sourcePeriod, basis: command.purpose === "ABSENCES" ? "REPORT_PERIOD_AND_ADMIN_DECLARATION" : "ADMIN_DECLARATION" },
    fileHash: hash(file.buffer), expectedImpactHash: "", canApply: blockers.length === 0, impact, blockers, warnings,
    counts: { addedPeople: impact.people.added.length, updatedPeople: impact.people.updated.length, removedPeople: impact.people.removed.length, unchangedPeople: impact.people.unchanged.length, addedAbsenceDays: impact.absences.added.length, removedAbsenceDays: impact.absences.removed.length, unchangedAbsenceDays: impact.absences.unchanged.length, assignmentChanges: impact.assignments.length, blockers: blockers.length },
    effect: { nextStatus: "DRAFT", needsRegeneration: Boolean(parsed.needsRegeneration), approvalInvalidated: invalidatesApproval, approvedPolicyVersionIdBefore: current.approvedPolicyVersionId, approvedPolicyVersionIdAfter: invalidatesApproval ? null : current.approvedPolicyVersionId } };
  preview.expectedImpactHash = hash(stableEscalaJson({ preview, candidate: parsed, authority, approvalState, extension: file.extension }));
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
    if (!preview.canApply) throw new EscalaError(422, "ESCALA_IMPORT_BLOCKED", "Resolva os impedimentos antes de substituir.");
  };
  check(result.preview);
  const workspace = await saveEscala(actor, current.id, command.expectedRevision, result.candidate, false, { adminImport: {
    removedAbsenceKeys: result.preview.impact.absences.removed.map(day => key({ ...day, kind: "ABSENCE" })), invalidatesApproval: result.preview.effect.approvalInvalidated,
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
