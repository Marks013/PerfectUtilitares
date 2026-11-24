import { isEscalaPlanningParticipant } from "./eligibility";
import { prisma } from "@/lib/prisma";
import { EscalaError, type EscalaActor } from "./access";
import { EscalaSolverError, solveEscala } from "./solver-client";
import { validateEscala } from "./validation";
import { logSolverRejection } from "./solver-diagnostics";
import { findGenerationConflicts } from "./generation-conflicts";
import { generationScenarioBasis, isHoursReferenceOnly, matchesHoursOnlyAssignments } from "./hours-reference";
import { dateRange } from "./dates";
import { admitDecemberCandidate, calculateWithDecemberFallback, prepareDecemberCoverage, selectDecemberCandidate } from "./december-origin.server";
import { planningContext } from "./planning-context.server";
import { checkWorkforceReady } from "./global-workforce-binding";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { admitCandidateReference, issueCandidateReceipt } from "./candidate-reference.server";
import { decemberEstimatedCoverageNotice, isOperationallyReusable } from "./roster-quality";
import type { EscalaCandidateResponse } from "./candidate-reference";
import { dailyMinuteCeiling, isMixed42LongShift, SUPERMARKET_CCT, usesMixed42Week } from "./labor-rules";
import type { EscalaInput, EscalaWorkspace } from "./types";
import { storeClosingLabel, workAfterStoreClosing } from "./store-hours";
import { manualAssignmentIssues } from "./shift-catalog/manual-override";
import { requireEscalaCapability } from "./access";
import { loadEscalaApproval } from "./approved-policy-service";
import { assertEscalaProtectedAssignments } from "./operational-input-policy";
import { signEscalaProposal } from "./proposal-proof";
import { preserveManualAbsences } from "./manual-absence";
import { preserveLockedAssignments } from "./draft-save-policy";
import { prepareWithMonthlyCarry } from "./monthly-carry-guard";

type GenerationDependencies = Pick<typeof import("./service"), "getEscala" | "parseEscalaInput" | "recheckEscalaGeneration"> & {
  assertRevision: (workspace: EscalaWorkspace, expectedRevision: number) => void;
};

function requireSolverSetup(input: EscalaInput) {
  const included = input.employees.filter((person) => isEscalaPlanningParticipant(person) && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  const timed = included.filter((person) => (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"));
  if (!included.length || (timed.length > 0 && (!input.shifts.length || timed.some((person) => !person.shiftIds.length)))) throw new EscalaError(422, "ESCALA_SETUP_REQUIRED", "Inclua pelo menos um colaborador e defina horários para quem tem jornada controlada. Pessoas sem horário fixo participam do rodízio de folgas sem turno fictício.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && input.policy.holidayRestAllowed) throw new EscalaError(422, "ESCALA_CCT_HOLIDAY_REST", "A CCT de supermercados veda compensar o DSR em feriado. Corrija a configuração antes de gerar.");
  const minutes = new Map(input.shifts.map((shift) => [shift.id, shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)]));
  const longMixed = new Set(input.shifts.filter(isMixed42LongShift).map(shift => shift.id));
  if (dateRange(input.startDate, input.endDate).some((date) => timed.some((person) => person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date)
    && person.shiftIds.every((shiftId) => !(longMixed.has(shiftId) && usesMixed42Week(input, person, date))
      && (minutes.get(shiftId) ?? Infinity) > Math.min(input.policy.dailyLimitMinutes, dailyMinuteCeiling(date)))))) {
    throw new EscalaError(422, "ESCALA_DAILY_LIMIT", "Os horários excedem o limite diário na vigência selecionada. Reaplique a configuração em lote da equipe para propor horários compatíveis; um acordo não amplia o teto deste regime.");
  }
  // Administrative compensation evidence is classified by referenceNotices; operational ceilings above remain mandatory.
}

export async function generateEscalaWith(deps: GenerationDependencies, actor: EscalaActor, id: string, expectedRevision: number, options?: import("./solver-transport").SolverOptions & { comparisonReference?: unknown }) {
  const { getEscala, assertRevision, parseEscalaInput, recheckEscalaGeneration } = deps;
  const { comparisonReference, ...solverOptions } = options ?? {};
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  await requireEscalaCapability(actor, "schedule.generate", current.input.branchCode);
  if (current.status === "PUBLISHED") throw new EscalaError(409, "ESCALA_REOPEN_REQUIRED", "Reabra a publicação como rascunho antes de gerar uma proposta.");
  checkWorkforceReady(current);
  let currentApprovalVerified = false;
  if (!actor.admin) {
    if (!current.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, current.approvedPolicyVersionId, prisma, current.input);
    currentApprovalVerified = true;
  }
  if (current.input.generationMode === "HOURS_ONLY" && !isHoursReferenceOnly(current.input)) {
    const existing = new Set(current.input.assignments.map(day => `${day.employeeId}\0${day.date}`));
    const incomplete = current.input.employees.some(person => isEscalaPlanningParticipant(person)
      && dateRange(current.input.startDate, current.input.endDate).some(date => date >= person.activeFrom
        && (!person.activeUntil || date <= person.activeUntil) && !existing.has(`${person.id}\0${date}`)));
    if (incomplete) throw new EscalaError(422, "ESCALA_HOURS_BASELINE_INCOMPLETE", "A grade está incompleta. Complete os dias ou gere folgas e horários antes de ajustar somente os horários; nenhum dia foi inventado.");
  }
  const qualityReference = structuredClone(current.input);
  const scope = { tenantId: actor.tenantId, owner: JSON.stringify([actor.userId, actor.moduleSessionId, actor.accountSessionId]), workspaceId: id, revision: expectedRevision };
  const prepared = prepareWithMonthlyCarry(current.input, prepareGeneration);
  if (isHoursReferenceOnly(prepared.input)) {
    const proposalInput = parseEscalaInput({ ...prepared.input, needsRegeneration: false, generationBasis: generationScenarioBasis(prepared.input) });
    try { preserveLockedAssignments(current.input, proposalInput); preserveManualAbsences(current.input, proposalInput); if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true); }
    catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
    if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_PROTECTED_RECORD_CHANGED"); }
    const validation = validateEscala(proposalInput);
    if (!validation.valid) { logSolverRejection("service-validation", "RULES_INVALID", { issues: validation.issues }); throw new EscalaError(422, "ESCALA_HOURS_REFERENCE_INVALID", "Alguns horários não atendem às regras do cenário. Confira entrada, intervalo, saída e fechamento; nenhum dia de trabalho ou folga foi criado."); }
    const finalScope = await recheckEscalaGeneration(actor, id, expectedRevision);
    const admission = admitCandidateReference(comparisonReference, scope, qualityReference, prepared.input);
    return { result: { status: "FEASIBLE" as const, outcome: { kind: "NEW_PROPOSAL" as const }, assignments: proposalInput.assignments, wallTimeSeconds: 0,
      message: "Referências de horários preparadas. Nenhuma presença diária, folga ou cobertura foi gerada." }, proposalInput, validation, preparation: prepared.preparation,
      comparison: admission.comparison, candidateReceipt: undefined,
      proposalProof: signEscalaProposal(finalScope, proposalInput) };
  }
  requireSolverSetup(prepared.input);
  const context = await planningContext(actor, id, parseEscalaInput(prepared.input));
  const { contextual, origin } = await prepareDecemberCoverage(actor, id, qualityReference, context, currentApprovalVerified);
  const closingConflict = workAfterStoreClosing(contextual).find(day => day.locked);
  if (closingConflict) throw new EscalaError(409, "ESCALA_CLOSING_PUBLISHED_CONFLICT", `Um dia já publicado em ${closingConflict.date} termina após o fechamento atual (${storeClosingLabel(contextual)}). Corrija o horário na escala publicada de origem ou ajuste o fechamento deste planejamento antes de gerar. O dia publicado foi preservado.`);
  const admission = admitDecemberCandidate(admitCandidateReference(comparisonReference, scope, qualityReference, contextual), origin);
  let protectedRestSpacing = false;
  const { calculation, retainedReference } = await calculateWithDecemberFallback(
    solveEscala(contextual, { ...solverOptions, qualityReference, admittedDecemberOrigin: origin, preserveImplicitLocks: !actor.admin,
      onRestSpacingProtected: () => { protectedRestSpacing = true; } }),
    origin && admission.input,
  );
  let result = calculation.status === "INFEASIBLE" ? {
    ...calculation, conflicts: [...findGenerationConflicts(contextual),
      ...(calculation.solverDiagnostics ?? []).map(diagnostic => ({
      code: `SOLVER_${diagnostic.family}`, message: diagnostic.message,
      target: diagnostic.family === "COVERAGE" ? "coverage" as const : "team" as const,
    }))],
    message: contextual.generationMode === "REST_ONLY"
      ? `${calculation.message} Neste modo, os horários de entrada e saída são mantidos. Se puder flexibilizá-los, selecione "Folgas e horários" e gere novamente.` : calculation.message,
  } : calculation;
  let proposalInput = contextual;
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    try {
      proposalInput = parseEscalaInput({ ...contextual, needsRegeneration: false, generationBasis: generationScenarioBasis(contextual), assignments: result.assignments });
    } catch {
      // Context was parsed before invoking the worker. Only its returned assignments are new here.
      logSolverRejection("service-schema", "SCHEMA_INVALID");
      throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
    }
  }
  try { preserveLockedAssignments(current.input, proposalInput); preserveManualAbsences(current.input, proposalInput); if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true); }
  catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
  if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_PROTECTED_RECORD_CHANGED"); }
  let validation = validateEscala(proposalInput);
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    const incomplete = validation.issues.some(issue => issue.code === "DAY_PENDING");
    const referencesChanged = !matchesRestOnlyReferences(contextual, result.assignments);
    if (referencesChanged || incomplete || !validation.valid) {
      logSolverRejection("service-validation", referencesChanged ? "REST_ONLY_CHANGED" : incomplete ? "MISSING_ACTIVE_DATE" : "RULES_INVALID", { issues: validation.issues });
      throw new EscalaSolverError(referencesChanged ? "SOLVER_PROTECTED_RECORD_CHANGED" : incomplete ? "SOLVER_RESPONSE_INCOMPLETE" : "SOLVER_RULES_INVALID");
    }
  }
  let comparison = admission.comparison;
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    const selected = selectDecemberCandidate(admission, proposalInput, qualityReference, origin, retainedReference, protectedRestSpacing);
    comparison = selected.comparison;
    if (comparison.selection === "REFERENCE_RETAINED") {
      proposalInput = parseEscalaInput(selected.input);
      preserveLockedAssignments(current.input, proposalInput);
      preserveManualAbsences(current.input, proposalInput);
      // Admission authenticates comparison; it does not replace operational protection.
      if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true);
      validation = validateEscala(proposalInput);
      if (!isOperationallyReusable(validation) || !matchesHoursOnlyAssignments(current.input, proposalInput)
        || !matchesRestOnlyReferences(contextual, proposalInput.assignments)
        || manualAssignmentIssues(proposalInput, contextual.assignments).length) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      result = { status: "FEASIBLE", outcome: { kind: "REFERENCE_RETAINED" }, assignments: proposalInput.assignments, wallTimeSeconds: result.wallTimeSeconds,
        message: "A nova alternativa perderia uma condição protegida. A proposta anterior verificada foi mantida integralmente. Confira a qualidade operacional antes de aplicar." };
    }
  }
  // Recheck after selection, even for a terminal result with no proposal proof.
  const finalScope = await recheckEscalaGeneration(actor, id, expectedRevision);
  const extra: EscalaCandidateResponse = { comparison };
  if ((result.status === "FEASIBLE" || result.status === "OPTIMAL") && isOperationallyReusable(validation)) {
    extra.candidateReceipt = issueCandidateReceipt(scope, qualityReference, contextual, proposalInput);
    const estimateNotice = protectedRestSpacing ? decemberEstimatedCoverageNotice(qualityReference, proposalInput) : undefined;
    if (estimateNotice) result = { ...result, message: `${result.message} ${estimateNotice}` };
  }
  return { result, proposalInput, validation, preparation: prepared.preparation, ...extra,
    ...((result.status === "FEASIBLE" || result.status === "OPTIMAL") ? { proposalProof: signEscalaProposal(finalScope, proposalInput) } : {}) };
}
