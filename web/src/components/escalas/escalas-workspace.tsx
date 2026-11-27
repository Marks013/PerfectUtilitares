"use client";

import { isAdministrativeEscalaSector, isEscalaPlanningParticipant } from "@/lib/escalas/eligibility";
import { CalendarDays } from "lucide-react";
import styles from "./escalas.module.css";
import { useEffect, useRef, useState } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import { planningMonth } from "@/lib/escalas/planning-month";
import { canUpgradePlanningCalendar } from "@/lib/escalas/calendar-upgrade";
import { isDecember2026Cutover, planningWeekStartsOn } from "@/lib/escalas/planning-calendar";
import type { EscalaExportMode } from "@/lib/escalas/presentation";
import type { EscalaInput, WeeklyHours } from "@/lib/escalas/types";
import { AbsenceImport } from "./absence-import";
import { ManualAbsences } from "./manual-absences";
import { Rules, Shifts } from "./configuration";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { CoverageTimeline } from "./coverage-timeline";
import { Coverage, ImportEmployees } from "./coverage-import";
import { EstimatedCoverageNotice } from "./coverage-notice";
import { DeletePlan } from "./delete-plan";
import { SAVE_LABEL } from "./draft-persistence";
import { Employees } from "./employees";
import { recoveryArea, revealRecoveryTarget, type EscalaRecoveryContext, type EscalaRecoveryRequest } from "./recovery-navigation";
import { GenerationModeOption, hasHourReferences } from "./generation-mode-option";
import { HoursReferencePreview } from "./hours-reference-preview";
import { ContinuousWorkOption, HoursProposal } from "./hours-proposal";
import { Mixed42Option } from "./mixed-42-option";
import { StoreClosingOption } from "./store-closing-option";
import { OperationalReports } from "./operational-reports";
import { Proposals, Publication, ValidationResults, type ReviewSection } from "./results";
import { PlanSelector, planPeriod } from "./plan-selector";
import { Roster } from "./roster";
import { ShiftSwap } from "./shift-catalog/shift-swap";
import { TurnoExport } from "./shift-catalog/turno-export";
import { useEscalasWorkspace } from "./use-escalas-workspace";
import type { ReviewTarget } from "./validation-guidance";
import { WorkspaceFeedback } from "./workspace-feedback";
import type { EscalaProblem, EscalaRecoveryAction } from "./workspace-feedback-model";
import { changeBranchWeeklyHours, clock, displayDate, errorMessage, HOURS, newInput, pruneMixed42Sectors } from "./workspace-model";
import { canDisplayEscalaAction, isEscalaAdministrator, useEscalaClientAccess } from "./access-context";
import { escalaCatalogActions, type EscalaWorkspaceAccessMetadata } from "@/lib/escalas/access-contracts";
import { ApprovedEmployeeForm, CreateApprovedPlan } from "./approved-forms";
import { ApprovalAdministration } from "./approval-administration";
import { OperatorAdministration } from "./operator-administration";
import { EscalaWorkforcePanel } from "./workforce-panel";

type Area = "team" | "generate" | "roster" | "coverage" | "review" | "adjustments" | "reports";
const AREAS: { id: Area; label: string }[] = [
  { id: "team", label: "Equipe" },
  { id: "generate", label: "Montar escala" },
  { id: "roster", label: "Horários, folgas e arquivos" },
];
const TOOLS: { id: Area; label: string }[] = [
  { id: "coverage", label: "Pessoas por horário" },
  { id: "review", label: "Avisos e orientações" },
  { id: "adjustments", label: "Configurações da filial" },
];

function CreatePlan({ disabled, create, initial = false }: { disabled: boolean; create: (input: ReturnType<typeof newInput>) => void; initial?: boolean }) {
  const access = useEscalaClientAccess();
  const administrative = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState(planningMonth);
  const [error, setError] = useState("");
  return <details className={styles.disclosure} open={initial || undefined}>
    <summary className={styles.disclosureTrigger}>Criar planejamento</summary>
    <form className={styles.disclosureBody} onSubmit={(event) => {
      event.preventDefault();
      setError("");
      try {
        if (!administrative) throw new Error("A configuração deste período precisa ser preparada pelo administrador.");
        if (!code.trim()) throw new Error("Informe o código da filial.");
        create(newInput(code, name.trim() || `Filial ${code.trim()}`, month, 40));
      } catch (cause) { setError(errorMessage(cause)); }
    }}>
      <fieldset disabled={disabled} className={styles.stackSmall}>
        <div className={`${styles.formGrid} ${styles.formGridWide}`}>
          <Field label="Código da filial">{(id) => <input id={id} required maxLength={40} value={code} onChange={(event) => setCode(event.target.value)} className={controlClass} />}</Field>
          <Field label="Nome da filial (opcional)">{(id) => <input id={id} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={controlClass} />}</Field>
          <Field label="Mês de referência">{(id) => <input id={id} required type="month" min="2000-02" max="2099-11" value={month} onChange={(event) => setMonth(event.target.value)} className={controlClass} />}</Field>
        </div>
        {error && <p role="alert" className={styles.errorText}>{error}</p>}
        <button type="submit" className={primaryClass}>Iniciar planejamento</button>
      </fieldset>
    </form>
  </details>;
}

export function EscalasStatus({ busy, notice, cancellable, onCancel, cancelLabel = "Cancelar análise", failed = false, error = "", problem, onAction, pendingSave = false, hasWorkspace = false }: {
  busy: string; notice: string; cancellable: boolean; onCancel: () => void; cancelLabel?: string; failed?: boolean;
  error?: string; problem?: EscalaProblem | null; pendingSave?: boolean; hasWorkspace?: boolean; onAction?: (action: EscalaRecoveryAction, context?: EscalaRecoveryContext) => void;
}) {
  if (pendingSave && !busy && !error && !problem) return <p role="status" className={styles.muted}>Alterações no rascunho. Aguardando confirmação do salvamento automático.</p>;
  if (hasWorkspace && !busy && !notice && !error && !problem && !failed) return null;
  const stage = busy ? /cancelamento|Cancelando/.test(busy) ? "Cancelando" : "Processando" : notice.startsWith("Cálculo cancelado.") ? "Cancelado" : problem?.outcome === "not-generated" ? "Proposta não gerada" : failed || error || problem?.tone === "error" ? "Falha" : problem?.tone === "warning" || /avisos|alterado|cancelada|pendências/i.test(notice) ? "Concluído com avisos" : notice ? "Concluído" : "Pronto";
  return <div className={styles.stackSmall}>
    <p className={styles.muted}><strong>{stage}.</strong>{!busy && !notice && !error && !problem && <span> Selecione a filial e o mês para planejar.</span>}</p>
    <WorkspaceFeedback busy={busy} notice={notice} error={error} problem={problem} onAction={onAction} />
    {busy && cancellable && <div className={styles.actions}><button type="button" className={buttonClass} onClick={onCancel}>{cancelLabel}</button></div>}
  </div>;
}

export function EscalasWorkspace() {
  const model = useEscalasWorkspace();
  const { input, workspace, conflict, readOnlyDraft } = model;
  const access = useEscalaClientAccess();
  const can = (capability: Parameters<typeof canDisplayEscalaAction>[1]) => canDisplayEscalaAction(access, capability, input?.branchCode);
  const readable = Boolean(input && workspace && can("workspace.read"));
  const manageSettings = can("settings.manage");
  const importTeam = can("import.manage");
  const generate = model.canGenerate && can("schedule.generate");
  const canSaveDraft = Boolean(workspace?.status === "DRAFT" && workspace.canEdit && can("workspace.save"));
  const editRoster = model.canEdit && can("schedule.apply") && can("workspace.save");
  const editTeam = model.canEdit && can("employee.manage") && can("workspace.save");
  const unrestricted = isEscalaAdministrator(access);
  const approvalRevoked = (workspace as Partial<EscalaWorkspaceAccessMetadata> | null)?.approvedPolicyRevoked === true;
  const catalog = access ? escalaCatalogActions(access, input?.branchCode ?? "") : { canDefine: false, canAssign: false };
  const canSwapShift = readable && !readOnlyDraft && !approvalRevoked && catalog.canAssign && can("workspace.save");
  const globalTeam = Boolean(workspace?.workforce);
  const canImportTeam = importTeam && model.canEdit && !globalTeam;
  const canAddApprovedEmployee = editTeam && !globalTeam
    && Boolean((workspace as Partial<EscalaWorkspaceAccessMetadata> | null)?.approvedPolicyVersionId) && !model.generated;
  const emptyTeamHelp = canImportTeam ? "Importe o relatório da equipe para começar."
    : canAddApprovedEmployee ? "Cadastre os colaboradores usando um modelo aprovado."
      : "Peça ao administrador para preparar a equipe desta filial.";
  const swapDisabled = !model.canEdit || model.dirty || model.saveState !== "saved" || Boolean(model.generated);
  const allowedPlans = unrestricted ? model.workspaces : model.workspaces.filter(plan => canDisplayEscalaAction(access, "workspace.read", plan.input.branchCode));
  const workforceBranches = [...new Set([...(access?.branches.map(branch => branch.code) ?? []),
    ...allowedPlans.map(plan => plan.input.branchCode)])].filter(code => canDisplayEscalaAction(access, "employee.manage", code)).sort();
  const [workforceBranch, setWorkforceBranch] = useState<string | null>(null);
  const [workforceOpen, setWorkforceOpen] = useState(false);
  const effectiveWorkforceBranch = workforceBranch ?? (editTeam ? input?.branchCode : undefined) ?? workforceBranches[0] ?? "";
  const multipleBranches = new Set(allowedPlans.map(plan => planPeriod(plan).branch)).size > 1;
  const fixedBranch = !unrestricted && access?.branches.filter(branch =>
    canDisplayEscalaAction(access, "workspace.read", branch.code)
  ).length === 1;
  const showEmptySelection = fixedBranch && allowedPlans.length === 0 && !model.error;
  const canCreate = model.canCreate && (unrestricted || access?.branches.some(branch => branch.capabilities.includes("workspace.create")) === true);
  const [area, setArea] = useState<Area>("team");
  const [visited, setVisited] = useState<Set<Area>>(() => new Set(["team"]));
  const [swapId, setSwapId] = useState<string | null>(null);
  const planPicker = useRef<HTMLDetailsElement>(null);
  const definitions = useRef<HTMLDetailsElement>(null);
  const [definitionTarget, setDefinitionTarget] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<{ id: string; revision: number } | null>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setVisited(previous => previous.has(area) ? previous : new Set([...previous, area])); }, [area]);
  const [reviewSection, setReviewSection] = useState<ReviewSection>();
  const [exportSelection, setExportSelection] = useState<{ workspaceId: string; generationMode: NonNullable<EscalaInput["generationMode"]>; mode: EscalaExportMode } | null>(null);
  const generationMode = input?.generationMode ?? "DAYS_AND_HOURS";
  const hoursOnly = generationMode === "HOURS_ONLY";
  const referencesOnly = Boolean(input && hoursOnly && !input.assignments.some(day => day.kind === "WORK" || day.kind === "DUTY"));
  const tools = TOOLS.filter(tool => (tool.id !== "coverage" || !referencesOnly && can("report.analytics")) && (tool.id !== "adjustments" || manageSettings));
  const exportMode = exportSelection?.workspaceId === workspace?.id && exportSelection?.generationMode === generationMode
    ? hoursOnly ? "hours" : exportSelection.mode : hoursOnly ? "hours" : generationMode === "REST_ONLY" ? "rest" : "both";
  const setExportMode = (mode: EscalaExportMode) => {
    setExportSelection({ workspaceId: workspace?.id ?? "", generationMode, mode });
  };
  const [reviewContext, setReviewContext] = useState<EscalaRecoveryRequest | null>(null);
  const [pendingReview, setPendingReview] = useState<EscalaRecoveryRequest | null>(null);
  const reviewSequence = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (model.error || model.problem) errorRef.current?.focus(); }, [model.error, model.problem]);
  const openedWorkspace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (openedWorkspace.current === workspace?.id) return;
    openedWorkspace.current = workspace?.id;
    setSwapId(null);
    setDefinitionTarget(null);
    setDiscardTarget(null);
    setReviewContext(null);
    setExportSelection(null);
    setPendingReview(null);
    setArea(workspace?.input.assignments.length ? "roster" : workspace?.input.employees.length ? "generate" : "team");
  }, [workspace?.id, workspace?.input.assignments.length, workspace?.input.employees.length]);
  useEffect(() => {
    if (!definitionTarget) return;
    if (!readable || !manageSettings || definitionTarget !== workspace?.id) { setDefinitionTarget(null); return; }
    if (area !== "adjustments" || !visited.has("adjustments") || !definitions.current) return;
    const target = definitions.current;
    const group = target.parentElement?.closest("details");
    if (group) group.open = true;
    target.open = true;
    const summary = target.querySelector<HTMLElement>("summary");
    if (summary) { summary.scrollIntoView({ block: "center" }); summary.focus({ preventScroll: true }); }
    setDefinitionTarget(null);
  }, [definitionTarget, workspace?.id, readable, manageSettings, area, visited]);
  useEffect(() => { if (model.generated) setArea("roster"); }, [model.generated]);
  useEffect(() => {
    if (!pendingReview || !visited.has(area) || area !== recoveryArea(pendingReview.target)) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      if (revealRecoveryTarget(pendingReview.target, document, pendingReview)) {
        setPendingReview(current => current?.request === pendingReview.request ? null : current);
      } else if (++attempts < 8) frame = window.requestAnimationFrame(reveal);
    };
    reveal();
    return () => window.cancelAnimationFrame(frame);
  }, [area, pendingReview, visited]);
  function resolve(target: ReviewTarget, context: EscalaRecoveryContext = {}) {
    if (target === "generate") { if (generate) model.generate(); return; }
    if (target === "intervals" && !manageSettings || target === "coverage" && !can("report.analytics")) { setArea("review"); return; }
    const review = { ...context, target, request: ++reviewSequence.current };
    setReviewContext(review);
    setPendingReview(review);
    setArea(recoveryArea(target));
  }
  function recover(action: EscalaRecoveryAction, context?: EscalaRecoveryContext) {
    if (model.busy) return;
    if (action === "reload") { model.compareLatest(); return; }
    if (action === "login") { window.dispatchEvent(new Event("escalas:unlock-required")); return; }
    resolve(action, context);
  }
  const includedIds = new Set(input?.employees.filter(isEscalaPlanningParticipant).map(person => person.id));
  const included = includedIds.size;
  const latestModel = useRef(model); latestModel.current = model;
  function confirmDiscard() {
    const current = latestModel.current;
    if (!discardTarget || current.workspace?.id !== discardTarget.id || current.workspace.revision !== discardTarget.revision
      || !current.dirty || current.busy || current.saveState === "saving") return;
    setDiscardTarget(null);
    current.discard();
  }
  const swapEmployee = input?.employees.find(person => person.id === swapId && !isAdministrativeEscalaSector(person.sector));
  const administrativeIds = new Set(input?.employees.filter(person => isAdministrativeEscalaSector(person.sector)).map(person => person.id));
  const hasRoster = Boolean(input?.assignments.some(day => !administrativeIds.has(day.employeeId)));
  const hasCalculatedRoster = Boolean(input?.assignments.some(day => includedIds.has(day.employeeId) && (day.kind === "WORK" || day.kind === "DUTY" || day.kind === "OFF")));
  const catalogContext = JSON.stringify([workspace?.id, workspace?.revision, input?.branchCode, input?.startDate, input?.endDate, input?.visibleMonth, model.dirty, Boolean(model.generated)]);
  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <CalendarDays className={styles.brandIcon} aria-hidden="true" />
        <div><h1 className={styles.title}>Escalas 5×2</h1><p className={styles.muted}>Sua equipe, os horários e as folgas em um só lugar.</p></div>
      </div>
      {access?.channel !== "USERNAME" && <span className={styles.workflowTag}>{access?.roleLabel ?? "Acesso ao módulo"}</span>}
    </header>

    <section className={panelClass} aria-labelledby="escala-list-title">
      <h2 id="escala-list-title" className="sr-only">Selecionar planejamento</h2>
      <details ref={planPicker} open={!workspace || undefined}>
      <summary className={styles.disclosureTrigger}>{workspace ? multipleBranches ? "Trocar filial ou período" : "Trocar período" : fixedBranch ? "Selecionar período" : "Selecionar filial e período"}</summary>
      <div className={`${styles.disclosureBody} ${styles.stackSmall}`}>
      {allowedPlans.length > 0 || showEmptySelection ? <PlanSelector plans={allowedPlans} selectedId={workspace?.id} disabled={Boolean(model.busy)} onSelect={model.open} showSummary={!workspace} /> : <p className={styles.muted}>{model.busy ? "Carregando planejamentos…" : model.error ? "Não foi possível carregar os planejamentos. Confira a orientação abaixo; nenhum cadastro foi apagado." : canCreate ? "Comece pela filial e pelo mês. Depois confira a equipe e monte a escala." : "Nenhuma escala disponível para este acesso. Peça ao administrador para liberar sua filial e o período."}</p>}
      {showEmptySelection && !model.busy && <p className={styles.muted}>{canCreate ? "Comece pelo mês. Depois confira a equipe e monte a escala." : "Peça ao administrador para liberar o período."}</p>}
      {canCreate && (unrestricted ? <CreatePlan initial={!allowedPlans.length} disabled={Boolean(model.busy || model.dirty || model.recovery || model.generated)} create={model.create} /> : <CreateApprovedPlan disabled={Boolean(model.busy || model.dirty || model.recovery || model.generated)} create={model.createApproved} createMonth={model.createMonth} />)}
      </div>
      </details>
    </section>
    {readable && <>
    {model.pendingOpen && <div className={`${panelClass} border-[color:var(--app-coral)]`} role="alert">
      <p>{model.dirty ? "Há alterações não salvas neste planejamento." : "Há uma proposta calculada que ainda não foi aplicada."} {model.generated && "Abrir outro planejamento descarta a candidata. Salvar o rascunho não aplica essa proposta."}</p>
      <div className={styles.actions}>
        <button type="button" className={buttonClass} onClick={() => model.setPendingOpen(null)}>{model.generated ? "Continuar conferindo a proposta" : "Continuar editando"}</button>
        {model.dirty && canSaveDraft && <button type="button" className={primaryClass} disabled={!model.canEdit || model.saveState === "saving"} onClick={() => { if (canSaveDraft && model.pendingOpen) model.saveAndOpen(model.pendingOpen); }}>{model.generated ? "Salvar rascunho, descartar candidata e abrir" : "Salvar e abrir"}</button>}
        <button type="button" className={buttonClass} onClick={() => { if (model.pendingOpen) model.open(model.pendingOpen, true); }}>{model.generated && !model.dirty ? "Descartar candidata e abrir" : "Descartar alterações e abrir"}</button>
      </div>
    </div>}
    {conflict && input && canDisplayEscalaAction(access, "workspace.read", conflict.input.branchCode) && <section className={panelClass} role="alert" aria-label="Comparar conflito de revisão"><h2 className={styles.sectionTitle}>Escolha como continuar sem sobrescrever em silêncio</h2><p>Servidor: revisão {conflict.revision}, {conflict.input.employees.length} colaboradores, {conflict.input.defaultWeeklyHours}h. Sua edição: {input.employees.length} colaboradores, {input.defaultWeeklyHours}h.</p><p>Usar sua edição substituirá o conteúdo do rascunho salvo na próxima revisão. A versão anterior permanece no histórico; bloqueios continuam protegidos pelo servidor.</p><details><summary className={styles.disclosureTrigger}>Conferir equipe e horários da revisão salva</summary><div className={styles.reviewScroller}><ul>{conflict.input.employees.map(person => <li key={person.id}>{person.registration} · {person.name} · {person.sector} / {person.role} · {person.weeklyHours}h · {person.planningEnabled === false ? "não incluído" : "incluído"}<span className="block">Horários: {person.shiftIds.map(id => conflict?.input.shifts.find(shift => shift.id === id)?.segments.map(segment => clock(segment.start) + "–" + clock(segment.end) + (segment.kind === "BREAK" ? " (intervalo)" : "")).join(" / ")).join("; ") || "Sem horário fixo"}. Folgas fixas: {person.fixedOffDays.length ? person.fixedOffDays.map(day => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ") : "nenhuma"}. {conflict.input.assignments.filter(day => day.employeeId === person.id && day.kind === "ABSENCE").length} dias de ausência; {conflict.input.assignments.filter(day => day.employeeId === person.id && day.locked).length} dias bloqueados.</span></li>)}</ul></div></details><div className={styles.actions}><button type="button" className={buttonClass} onClick={model.closeConflict}>Manter edição aberta sem substituir</button><button type="button" className={buttonClass} onClick={model.useServerRevision}>Usar revisão do servidor e descartar edição local</button><button type="button" className={primaryClass} disabled={!conflict.canEdit} onClick={model.rebaseDraft}>Usar minha edição sobre a revisão {conflict.revision}</button></div></section>}
    {!model.localBackup && model.dirty && <p role="alert" className={styles.errorText}>O navegador não conseguiu guardar uma cópia temporária. Não recarregue nem feche esta aba antes da confirmação do salvamento.</p>}
    {model.recovery && workspace && <section className={panelClass} role="alert" aria-label="Rascunho recuperável"><h2 className={styles.sectionTitle}>Há um rascunho preservado neste navegador</h2><p>Originado na revisão {model.recovery.baseRevision}; a revisão salva atual é {workspace.revision}. {model.recovery.baseRevision !== workspace.revision ? "Restaurar usará seu rascunho como conteúdo da próxima revisão, substituindo o conteúdo atual após o salvamento. Confira antes de escolher. O histórico será mantido." : "Você pode retomar a edição sem refazer a importação."}</p><div className={styles.actions}><button type="button" className={primaryClass} onClick={model.recoverDraft}>Restaurar meu rascunho sobre a revisão {workspace.revision}</button><button type="button" className={buttonClass} onClick={model.ignoreRecovery}>Manter somente a revisão salva</button></div></section>}
    </>}
    <div ref={errorRef} tabIndex={-1} className={styles.feedbackFocus}>{(!workspace || readable) && <EscalasStatus hasWorkspace={Boolean(workspace)} pendingSave={model.dirty} busy={model.busy} notice={model.notice} error={model.error} problem={model.problem} onAction={recover} failed={Boolean(model.error)} cancellable={model.cancellable} onCancel={model.cancelAnalysis} cancelLabel={model.cancelLabel} />}</div>

    {input && workspace && can("workspace.read") && <div key={workspace.id} className={styles.stack}>
      <section className={`${panelClass} ${styles.scenario}`} aria-labelledby="escala-scenario-title">
        <div className={styles.header}>
          <div className="min-w-0"><h2 id="escala-scenario-title" className={styles.sectionTitle}>Filial {input.branchCode} · {input.branchName}</h2>
            <p className={styles.subtitle}>{displayDate(visibleDates(input)[0])} a {displayDate(visibleDates(input).at(-1) ?? input.endDate)} · {included} na equipe · revisão {workspace.revision}</p>
            <p className={styles.muted}>Semana: {planningWeekStartsOn(input) === "SUNDAY" ? "domingo a sábado. O domingo inicia uma nova semana." : "segunda a domingo (planejamento anterior)."}</p>
            {isDecember2026Cutover(input) && <p className={styles.muted}>Programe duas folgas entre 1º e 5 de dezembro. A semana seguinte começa no dia 6.</p>}
          </div>
          <span role="status" className={styles.saveStatus} data-state={model.saveState}>{SAVE_LABEL[model.saveState]} · {workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
        </div>
      </section>
      {canUpgradePlanningCalendar(input) && unrestricted && workspace.canEdit && model.canCreate && <section className={panelClass} aria-label="Atualizar semana do planejamento">
        <p className={styles.muted}>{input.visibleMonth === "2026-12"
          ? "Crie um rascunho de 1º a 31 de dezembro. A escala original, os afastamentos e os bloqueios do mês serão preservados."
          : "Para usar domingo como primeiro dia da semana, crie um novo rascunho a partir deste. O original, seus afastamentos e bloqueios serão preservados."}</p>
        <button type="button" className={buttonClass} disabled={!model.canEdit || model.saveState === "saving"} onClick={model.upgradeCalendar}>{input.visibleMonth === "2026-12" ? "Criar rascunho de dezembro" : "Usar semana de domingo a sábado"}</button>
      </section>}
      <nav aria-label="Etapas do planejamento" className={styles.guidedNavigation}>
        {AREAS.map((item, index) => <button key={item.id} type="button" aria-current={area === item.id ? "step" : undefined} aria-pressed={area === item.id} aria-controls={`escala-area-${item.id}`} className={styles.guidedStep} onClick={() => setArea(item.id)}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><span><strong>{item.label}</strong><small>{item.id === "team" ? included ? `${included} ${included === 1 ? "colaborador incluído" : "colaboradores incluídos"}` : "Confira os colaboradores da filial" : item.id === "generate" ? `${input.defaultWeeklyHours} horas por semana · modelo 5×2` : hasRoster ? "Escala disponível para conferir" : "Confira antes de baixar os arquivos"}</small></span></button>)}
      </nav>
      {can("report.analytics") && visited.has("reports") && <section hidden={area !== "reports"} inert={area !== "reports"} id="escala-area-reports" aria-label="Área de relatórios e gráficos PDF"><OperationalReports key={`${workspace.id}:${workspace.revision}`} workspace={workspace} disabled={Boolean(model.busy || model.dirty || model.recovery || model.saveState !== "saved")} /></section>}
      <section hidden={area !== "generate"} inert={area !== "generate"} id="escala-area-generate" className={`${panelClass} ${styles.generationPanel}`} aria-labelledby="escala-generate-title">
        <div><h2 id="escala-generate-title" className={styles.sectionTitle}>Monte uma proposta para conferir</h2><p className={styles.muted}>{hoursOnly ? "Ajusta horários sem redistribuir os dias. Se ainda não há grade, prepara referências de horários para conferência." : generationMode === "REST_ONLY" ? "O algoritmo distribui as folgas usando os horários de referência ajustados à jornada. Você revisa antes de aplicar." : "Os horários, as folgas e a cobertura estimada são calculados juntos. Você revisa antes de aplicar."}</p></div>
        <GenerationModeOption input={input} disabled={!manageSettings || !generate || !model.canEdit || !can("workspace.save")} onChange={model.update} />
        <div className={styles.contextBar}>
          <fieldset disabled={!model.canEdit || !manageSettings} className={styles.journeyField}>
            <Field label="Jornada semanal">{(id) => <select id={id} value={input.defaultWeeklyHours} className={controlClass} onChange={(event) => model.update(changeBranchWeeklyHours(input, Number(event.target.value) as WeeklyHours))}>{HOURS.map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}</select>}</Field>
          </fieldset>
          <p className={styles.muted}>{input.defaultWeeklyHours === 42 && input.mixed42Sectors?.length ? <>Distribuição administrativa de 42h: três dias de 8h e dois de 9h nas semanas completas elegíveis.<br />Setores: {input.mixed42Sectors.join(", ")}. Nos dias de 9h, intervalo não trabalhado de 3h. Sem grade, são apenas referências para conferir.</> : <><strong className="text-[color:var(--app-fg)]">{clock(input.defaultWeeklyHours * 12)}</strong> de trabalho por dia no modelo uniforme, em 5 dias.<br />O intervalo fica à parte.</>} Afastamentos, bloqueios e exceções individuais são preservados.</p>
          <div className={styles.mainActions}>
            {model.dirty && canSaveDraft && <button type="button" className={buttonClass} disabled={!model.canEdit || model.saveState === "saving"} onClick={model.save}>{["error", "conflict", "invalid"].includes(model.saveState) ? "Tentar salvar" : "Salvar agora"}</button>}
            <button type="button" className={primaryClass} disabled={!generate || included === 0} onClick={model.generate}>{model.busy ? "Processando…" : hoursOnly ? referencesOnly ? "Preparar horários da equipe" : "Gerar proposta de horários" : hasRoster ? "Gerar nova proposta" : generationMode === "REST_ONLY" ? "Gerar folgas" : "Gerar escala e horários"}</button>
          </div>
        </div>
        {model.dirty && !canSaveDraft && <div className={styles.stackSmall}>
          <p role="status" className={styles.muted}>A prévia está bloqueada porque há alterações locais e seu acesso não permite salvá-las. Você pode descartar essas alterações e conferir a última revisão salva.</p>
          <div className={styles.actions}><button ref={discardButton} type="button" className={buttonClass} disabled={Boolean(model.busy) || model.saveState === "saving"} aria-expanded={discardTarget?.id === workspace.id && discardTarget.revision === workspace.revision} aria-controls="escala-confirm-discard" onClick={() => setDiscardTarget({ id: workspace.id, revision: workspace.revision })}>Descartar alterações locais</button></div>
          {discardTarget?.id === workspace.id && discardTarget.revision === workspace.revision && <fieldset id="escala-confirm-discard" className={`${styles.stackSmall} min-w-0 border-0 p-0`}>
            <legend className="sr-only">Confirmar descarte das alterações locais</legend>
            <p>Descartar as alterações locais deste planejamento e carregar a última revisão salva? O descarte não salva o rascunho nem altera a revisão no servidor.</p>
            <div className={styles.actions}>
              <button type="button" className={buttonClass} onClick={() => { setDiscardTarget(null); discardButton.current?.focus(); }}>Manter alterações locais</button>
              <button type="button" className={buttonClass} disabled={Boolean(model.busy) || model.saveState === "saving"} onClick={confirmDiscard}>Confirmar descarte e carregar revisão salva</button>
            </div>
          </fieldset>}
        </div>}
        {!manageSettings && <p className={styles.muted}>A jornada e as regras desta filial foram definidas pelo administrador. Você pode montar a escala com essas configurações.</p>}
        {!included && <div className={styles.nextStep}><p>{importTeam ? "Importe a equipe da filial antes de montar a escala." : "A equipe ainda não foi preparada. Peça ao administrador para importar os colaboradores desta filial."}</p><button type="button" className={buttonClass} onClick={() => setArea("team")}>Conferir equipe</button></div>}
        {manageSettings && <details className={styles.disclosure}><summary className={styles.disclosureTrigger}>Regras de jornada e intervalos</summary><div className={styles.stackSmall}>
          <StoreClosingOption input={input} disabled={!model.canEdit} onChange={model.update} />
          <Mixed42Option input={input} disabled={!model.canEdit} onChange={model.update} />
          <ContinuousWorkOption input={input} disabled={!model.canEdit} onChange={model.update} />
          <button type="button" className={buttonClass} onClick={() => resolve("intervals")}>Simular jornada de mais de 4h até 6h sem pausa de 15 min</button>
        </div></details>}
        {can("report.analytics") && <EstimatedCoverageNotice validation={model.validation} hasRoster={hasCalculatedRoster} outdated={model.outdated} onReview={() => { setReviewSection("coverage"); setArea("review"); }} />}
        {catalog.canDefine && input.employees.length > 0 && generationMode !== "REST_ONLY" && <HoursProposal input={input} disabled={!model.canEdit} onChange={model.update} />}
        {readOnlyDraft && <p role="status" className={styles.muted}>Rascunho disponível para consulta. Para gerar, alterar ou baixar arquivos, solicite a aprovação administrativa.</p>}
        {approvalRevoked && <p role="status" className={styles.muted}>A configuração deste rascunho foi revogada. Solicite ao administrador que vincule uma versão vigente para editar ou gerar.</p>}
        {workspace.workforce?.needsSync && <p role="status" className={styles.muted}>A equipe global mudou. Reabra o rascunho para atualizar antes de calcular ou publicar.
          {workspace.canEdit && !model.busy && !model.dirty && !model.recovery && <button type="button" className={buttonClass} onClick={() => model.open(workspace.id)}>Atualizar equipe do rascunho</button>}</p>}
        {!readOnlyDraft && !approvalRevoked && !workspace.canEdit && !model.dirty && <p className={styles.muted}>{can("schedule.generate")
          ? "Você pode gerar uma proposta para conferir. Aplicar ou salvar alterações exige permissão de edição nesta filial."
          : "Acesso de consulta nesta filial."}</p>}
      </section>

      <details className={styles.optionalTools} open={tools.some(item => item.id === area) || area === "reports" || undefined}>
        <summary className={styles.disclosureTrigger}>Conferências e configurações</summary>
        <nav aria-label="Áreas do planejamento" className={styles.actions}>{tools.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} aria-controls={`escala-area-${item.id}`} className={`${buttonClass} ${styles.areaTab}`} onClick={() => setArea(item.id)}>{item.label}</button>)}</nav>
        {can("report.analytics") && <nav aria-label="Relatórios opcionais" className={styles.actions}>
          <button type="button" className={`${buttonClass} ${styles.areaTab}`} aria-pressed={area === "reports"} aria-controls="escala-area-reports" onClick={() => setArea("reports")}>Relatórios e gráficos PDF</button>
        </nav>}
      </details>

      {visited.has("team") && <section hidden={area !== "team"} inert={area !== "team"} id="escala-area-team" aria-labelledby="escala-team-title" className={styles.stackSmall}>
        <div id="escala-team" tabIndex={-1}><h2 id="escala-team-title" className={styles.sectionTitle}>Equipe da filial</h2><p className={styles.muted}>{included ? `${included} colaboradores incluídos. Confira os dados antes de montar a escala.` : emptyTeamHelp}</p></div>
        {importTeam && !globalTeam && workspace.status === "DRAFT" && <details className={styles.disclosure} open={!included || undefined}><summary className={styles.disclosureTrigger}>Importar ou atualizar arquivos da equipe</summary><div className={styles.stackSmall}>
          <ImportEmployees workspace={workspace} disabled={workspace.status !== "DRAFT" || !workspace.canEdit || Boolean(model.recovery || model.generated || model.conflict)} operationPending={Boolean(model.busy)} pendingSave={model.dirty} onSave={model.save} replaceImport={model.replaceImport} />
          <AbsenceImport workspace={workspace} disabled={workspace.status !== "DRAFT" || !workspace.canEdit || Boolean(model.recovery || model.generated || model.conflict)} operationPending={Boolean(model.busy)} pendingSave={model.dirty} onSave={model.save} replaceImport={model.replaceImport} />
        </div></details>}
        {(!globalTeam || Boolean(workspace.workforce?.legacyAbsenceDays?.length)) && workspace.canEdit && workspace.status === "DRAFT" && can("workspace.save") && can("employee.manage") && <ManualAbsences key={workspace.id + ":" + workspace.revision}
          workspace={workspace} administrator={unrestricted} legacyOnly={globalTeam}
          disabled={Boolean(!model.canEdit || model.dirty || model.saveState !== "saved" || model.generated || model.conflict)}
          changeAbsence={model.changeAbsence} />}
        {input.employees.length > 0 && <details id="escala-team-restrictions" className={panelClass}><summary className={styles.disclosureTrigger}>Ver colaboradores e ajustar cadastro</summary>
          <div id="escala-team-review" tabIndex={-1} className="scroll-mt-24 rounded-md p-2 focus:outline-2 focus:outline-[color:var(--app-action-blue)]">
            {reviewContext?.target === "team" && <p className={styles.muted}>Localize o colaborador indicado e use Editar para conferir folgas fixas e horários permitidos. Dias bloqueados e ausências aparecem na área Escala. Nada será alterado apenas por abrir esta conferência.</p>}
          </div>
          <Employees input={input} disabled={!editTeam} managedTeam={globalTeam} swapDisabled={swapDisabled} onSwap={canSwapShift ? person => setSwapId(person.id) : undefined} onRemoveEmployee={globalTeam ? undefined : model.removeEmployee} onChange={(next) => model.update(manageSettings ? pruneMixed42Sectors(next) : next)} review={reviewContext?.target === "team" ? reviewContext : undefined} />
          {canSwapShift && swapEmployee && generationMode !== "REST_ONLY" && <ShiftSwap key={workspace.id + ":" + workspace.revision + ":" + swapEmployee.id} workspace={workspace} employee={swapEmployee} disabled={swapDisabled} onClose={() => setSwapId(null)} onApplied={() => { setSwapId(null); if (latestModel.current.workspace?.id === workspace.id) latestModel.current.open(workspace.id); }} />}
        </details>}
        {input.employees.length === 0 && unrestricted && !globalTeam && <Employees input={input} disabled={!editTeam} onChange={model.update} />}
        {!globalTeam && can("employee.manage") && <ApprovedEmployeeForm key={workspace.id} workspace={workspace} disabled={!editTeam || Boolean(model.generated)} add={model.addEmployee} />}
        {included > 0 && <div className={styles.nextStep}><div><strong>Equipe pronta para o próximo passo</strong><p className={styles.muted}>Confira os colaboradores e os afastamentos registrados antes de montar a escala.</p></div><button type="button" className={primaryClass} onClick={() => setArea("generate")}>Continuar para montar escala</button></div>}
      </section>}

      {visited.has("roster") && <section hidden={area !== "roster"} inert={area !== "roster"} id="escala-area-roster" className={styles.stackSmall} aria-label="Revisar escala mensal">
        {can("report.analytics") && <EstimatedCoverageNotice validation={model.validation} hasRoster={hasCalculatedRoster} outdated={model.outdated} onReview={() => { setReviewSection("coverage"); setArea("review"); }} />}
        <div><h2 className={styles.sectionTitle}>{readOnlyDraft ? "Confira a escala" : "Revise e baixe os arquivos"}</h2><p className={styles.muted}>{referencesOnly ? "Confira os horários de referência por setor. Nenhuma presença ou folga foi inventada." : hoursOnly ? "Confira os horários. Os dias de trabalho, folgas e afastamentos foram mantidos." : "Confira os horários e as folgas. Para ajustar um dia, selecione a célula na grade."}</p></div>
        {model.outdated && hasRoster && <div role="status" className="app-radius-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-4 text-sm"><strong>Cenário alterado.</strong> A grade anterior fica visível para comparação, mas precisa ser gerada novamente antes de exportar.</div>}
        <Proposals active={area === "roster"} input={input} generated={model.generated} disabled={!editRoster} onGenerated={model.applyGenerated} onDismiss={model.dismissProposals} />
        <div id="escala-roster" tabIndex={-1} className="min-w-0">
          {hasRoster && <p className={styles.muted}>Grade atual · revisão salva {workspace.revision}{model.dirty ? " · alterações aguardando salvamento" : ""}{model.generated ? " · a candidata acima ainda não foi aplicada" : ""}.</p>}
          {referencesOnly && hasHourReferences(input) ? <HoursReferencePreview input={input} /> : hasRoster ? <Roster active={area === "roster"} key={workspace.id} input={input} openEndedAbsenceEmployeeIds={workspace.workforce?.openEndedAbsenceEmployeeIds} review={reviewContext?.target === "roster" ? reviewContext : undefined} mode={exportMode} onModeChange={setExportMode} onReviewEmployee={employeeId => resolve("team", { employeeId })} onReviewCoverage={() => { setReviewSection("coverage"); setArea("review"); }} validation={model.validation} disabled={!editRoster} canUnlock={manageSettings && workspace.canPublish} onUndo={model.undoRoster} onChange={model.update} /> : !model.generated && <div className={`${panelClass} ${styles.emptyState}`}><h2 className={styles.sectionTitle}>Seu resultado aparecerá aqui</h2><p className="mt-2 text-sm text-[color:var(--app-muted)]">{included ? "Escolha a jornada e gere a proposta. O algoritmo prepara somente o conteúdo selecionado." : emptyTeamHelp}</p>{!included && (canImportTeam || canAddApprovedEmployee) && <button type="button" className={`${buttonClass} mt-4`} onClick={() => setArea("team")}>{canImportTeam ? "Importar equipe" : "Cadastrar colaboradores"}</button>}</div>}
        </div>
        {(hasRoster || referencesOnly && hasHourReferences(input) || workspace.status === "PUBLISHED") && <><div className={styles.actions}>{can("report.analytics") && !referencesOnly && <button type="button" className={buttonClass} onClick={() => setArea("coverage")}>Onde falta gente?</button>}<button type="button" className={buttonClass} onClick={() => setArea("review")}>Conferir avisos e orientações</button><button type="button" className={buttonClass} onClick={() => setArea("generate")}>Voltar para montar escala</button></div>{!readOnlyDraft && <Publication mode={exportMode} onModeChange={setExportMode} key={workspace.id} workspace={workspace} validation={model.validation} dirty={model.dirty} outdated={model.outdated} busy={Boolean(model.busy || model.recovery)} onPublish={model.publish} onReopen={() => model.publish("REOPEN_PUBLICATION")} onRegenerate={generate ? model.generate : undefined} onPrepare={model.flushDraft} isCurrent={model.isCurrentRevision} candidatePending={Boolean(model.generated)} canUseCandidate={editRoster && Boolean(model.generated?.validation.valid)} onUseCandidate={model.applyGenerated} />}</>}
      </section>}

      {can("report.analytics") && !referencesOnly && visited.has("coverage") && <section hidden={area !== "coverage"} inert={area !== "coverage"} id="escala-area-coverage" className={styles.stackSmall} aria-label="Cobertura da filial"><CoverageTimeline key={workspace.id} input={input} review={reviewContext?.target === "coverage" ? reviewContext : undefined} /><div id="escala-coverage" tabIndex={-1}><Coverage input={input} disabled={!model.canEdit} onChange={model.update} review={reviewContext?.target === "coverage" ? reviewContext : undefined} /></div></section>}

      {visited.has("review") && <section hidden={area !== "review"} inert={area !== "review"} id="escala-area-review" className={styles.stackSmall} aria-label="Central de revisão e suporte">
        <ValidationResults active={area === "review"} section={reviewSection} onSectionChange={setReviewSection} input={input} validation={model.validation} onResolve={model.canEdit ? resolve : undefined} />
        <section className={panelClass}><h2 className={styles.sectionTitle}>Sugestões e critérios do planejamento</h2>
          <p className={styles.muted}>Nada é corrigido apenas por abrir esta área. Uma nova proposta pode ser comparada e descartada antes de aplicar.</p>
          <div className={styles.actions}><button type="button" className={buttonClass} disabled={!generate || !included} onClick={model.generate}>{hoursOnly ? "Sugerir novos horários" : generationMode === "REST_ONLY" ? "Sugerir nova distribuição de folgas" : "Sugerir nova distribuição de folgas e horários"}</button>{can("report.analytics") && !referencesOnly && <button type="button" className={buttonClass} onClick={() => setArea("coverage")}>Conferir desfalques por horário</button>}</div>
          <p className="text-sm">{referencesOnly ? "Prioridades: preparar referências coerentes com a jornada e o fechamento. Não cria dias de trabalho, folgas ou cobertura diária." : hoursOnly ? "Prioridades: preservar os dias de trabalho, folgas, afastamentos e bloqueios; ajustar somente os horários permitidos para melhorar a cobertura." : "Prioridades: preservar restrições obrigatórias; melhorar a cobertura estimada por setor e cargo; distribuir folgas e fins de semana; reduzir alterações; respeitar preferências individuais."} Pessoas com cargos diferentes não se substituem automaticamente.</p>
          <p className="text-sm">Preferências são as escolhas explícitas cadastradas para esta equipe. Não há aprendizado automático nem envio de dados a serviços externos. Ausência de interação não significa aprovação.</p>
          <p className="text-sm">FPRE136 fornece horários originais, não comprova a carga semanal contratual. A jornada selecionada orienta o cenário; cargas individuais explicitamente informadas são preservadas.</p>
        </section>
      </section>}

      {manageSettings && visited.has("adjustments") && <section hidden={area !== "adjustments"} inert={area !== "adjustments"} id="escala-area-adjustments" className={styles.stack} aria-label="Configurações administrativas da filial">
        <ApprovalAdministration key={workspace.id + ":" + workspace.revision} workspace={workspace} disabled={Boolean(model.busy || model.dirty || model.recovery || model.generated)} prepare={model.flushDraft} rebase={model.rebaseApproved} />
        <details className={panelClass}>
          <summary className={styles.disclosureTrigger}>Regras e exceções da filial</summary>
          <p className={styles.muted}>Abra apenas para conferir exceções, limites, intervalos ou turnos específicos. Não é necessário preencher estes ajustes para gerar a proposta.</p>
          <div id="escala-rules" tabIndex={-1}><Rules input={input} disabled={!model.canEdit} onChange={model.update} /></div>
          <details ref={definitions} id="escala-advanced" tabIndex={-1} className={styles.disclosure}><summary className={styles.disclosureTrigger}>Turnos específicos</summary><Shifts input={input} disabled={!model.canEdit} onChange={model.update} /></details>
        </details>
        <div className={styles.actions}><button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.validate}>Conferir dados atuais</button><button type="button" className={buttonClass} disabled={!model.dirty || Boolean(model.busy) || model.saveState === "saving"} onClick={model.discard}>Descartar alterações locais</button></div>
        <DeletePlan workspace={workspace} dirty={model.dirty} busy={Boolean(model.busy)} onDelete={model.deleteWorkspace} />
      </section>}
    </div>}
    {(unrestricted || workforceBranches.length > 0) && <details className={panelClass} onToggle={event => setWorkforceOpen(event.currentTarget.open)}>
      <summary className={styles.disclosureTrigger}>Base global de equipes e afastamentos</summary>
      {workforceOpen && <div className={styles.stackSmall}>
        <Field label="Filial para consultar na base global">
          {id => unrestricted
            ? <input id={id} className={controlClass} list="escala-workforce-branches" value={effectiveWorkforceBranch} onChange={event => setWorkforceBranch(event.target.value)} />
            : <select id={id} className={controlClass} value={effectiveWorkforceBranch} onChange={event => setWorkforceBranch(event.target.value)}>
              {workforceBranches.map(code => <option key={code} value={code}>{code}</option>)}
            </select>}
        </Field>
        <datalist id="escala-workforce-branches">{workforceBranches.map(code => <option key={code} value={code} />)}</datalist>
        {Boolean(effectiveWorkforceBranch.trim()) && <EscalaWorkforcePanel key={effectiveWorkforceBranch} branchCode={effectiveWorkforceBranch} canImport={unrestricted && importTeam}
          onChanged={() => {
            const latest = latestModel.current;
            if (workspace?.status === "DRAFT" && latest.workspace?.id === workspace.id && latest.resetKey === model.resetKey && latest.isCurrentRevision(workspace)
              && !latest.busy && !latest.dirty && !latest.generated && !latest.recovery && !latest.conflict && !latest.pendingOpen
              && latest.saveState === "saved" && latest.workspace?.status === "DRAFT") latest.open(workspace.id);
          }} />}
      </div>}
    </details>}
    {unrestricted && <OperatorAdministration />}
    {unrestricted && can("export.integration") && <section className={styles.stackSmall} aria-label="Catálogo administrativo de turnos">
      <TurnoExport key={catalogContext} plans={allowedPlans} disabled={Boolean(model.busy || model.dirty || model.recovery || model.generated || workspace && model.saveState !== "saved")} />
      <details className={styles.disclosure}>
        <summary className={styles.disclosureTrigger}>Criar ou alterar definições de turnos</summary>
        <p className={styles.muted}>As definições são editadas pelo administrador em um planejamento autorizado. Consultar ou exportar o catálogo não altera horários. O cadastro no catálogo exige confirmação explícita das referências salvas.</p>
        {readable && manageSettings && workspace ? <button type="button" className={buttonClass} onClick={() => { setDefinitionTarget(workspace.id); setArea("adjustments"); }}>Abrir definições deste planejamento</button>
          : <button type="button" className={buttonClass} onClick={() => { const picker = planPicker.current; if (picker) { picker.open = true; picker.querySelector<HTMLElement>("summary")?.focus(); picker.scrollIntoView({ block: "start" }); } }}>{canCreate ? "Escolher ou criar planejamento para editar definições" : "Escolher planejamento para editar definições"}</button>}
      </details>
    </section>}
  </div>;
}

