"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftSaveQueue, parseSavedWorkspace, sameDraft, type SaveState } from "./draft-persistence";
import { isCurrentRosterChange } from "./roster-model";
import { clearRecovery, readRecovery, saveRecovery, type RecoverableDraft } from "./draft-recovery";
import type { EscalaInput, EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import { coverageDefinitionChanged, hasOutdatedResults, isCurrentResponse, responseMessage, scenarioDefinitionChanged } from "./workspace-model";
import { requestMassGeneration, type GeneratedProposal } from "./mass-generation";
import { GenerationOperation, generationCancellationNotice } from "./generation-operation";
import { EscalaRequestError, invalidatesCandidate, responseCode, solverProblem, toEscalaProblem, type EscalaProblem } from "./workspace-feedback-model";
import { operationalCommand } from "./operational-client";
import { canDisplayEscalaAction, isEscalaAdministrator, useEscalaClientAccess } from "./access-context";
import { pendingNavigation } from "./workspace-navigation";
import type { EscalaWorkspaceAccessMetadata } from "@/lib/escalas/access-contracts";
import type { ImportSyncCommand } from "@/lib/escalas/import-sync-contracts";
import { requestImportReplacement, type ImportReplacementResult } from "./import-replacement-client";
import { canUpgradePlanningCalendar } from "@/lib/escalas/calendar-upgrade";
import { workspaceTeamActions } from "./workspace-team-actions";

export type WorkspaceSummary = Pick<EscalaWorkspace, "id" | "revision" | "status" | "updatedAt"> & {
  input: Pick<EscalaInput, "branchCode" | "branchName" | "startDate" | "endDate" | "visibleMonth" | "planningWeekStartsOn">;
};
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  init?.signal?.throwIfAborted();
  const response = await fetch(url, { cache: "no-store", ...init });
  init?.signal?.throwIfAborted();
  if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    init?.signal?.throwIfAborted();
    throw new EscalaRequestError("INVALID_RESPONSE", response.status, "O servidor não retornou uma resposta válida.");
  }
  init?.signal?.throwIfAborted();
  if (!response.ok) {
    throw new EscalaRequestError(responseCode(body), response.status, responseMessage(body));
  }
  return body as T;
}

export function useEscalasWorkspace() {
  const access = useEscalaClientAccess();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [workspace, setWorkspace] = useState<EscalaWorkspace | null>(null);
  const [input, setInput] = useState<EscalaInput | null>(null);
  const [validation, setValidation] = useState<EscalaValidation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [busy, setBusy] = useState("Carregando planejamentos…");
  const [cancellable, setCancellable] = useState(false);
  const [cancelLabel, setCancelLabel] = useState("Cancelar análise");
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<EscalaProblem | null>(null);
  const [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState<GeneratedProposal | null>(null);
  const generatedReference = useRef<{ proposal: GeneratedProposal; workspaceId: string; revision: number; input: EscalaInput } | null>(null);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const working = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const selectionEpoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const generationOperation = useRef<GenerationOperation | null>(null);
  const cancellationRunning = useRef(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [recovery, setRecovery] = useState<RecoverableDraft | null>(null);
  const [sessionLocked, setSessionLocked] = useState(false);
  const accessLocked = useRef(false);
  const indexVersion = useRef(0);
  const [localBackup, setLocalBackup] = useState(true);
  const [conflict, setConflict] = useState<EscalaWorkspace | null>(null);
  const unresolvedRecovery = useRef(recovery);
  unresolvedRecovery.current = recovery;
  const latestWorkspace = useRef(workspace);
  const latestAccess = useRef(access); latestAccess.current = access;
  const latestInput = useRef(input);
  const latestDirty = useRef(dirty);
  latestWorkspace.current = workspace; latestInput.current = input; latestDirty.current = dirty;
  const saver = useRef<DraftSaveQueue | null>(null);
  const sessionRequests = useRef(new AbortController());
  if (!saver.current) saver.current = new DraftSaveQueue({
    send: (base, draft) => requestJson<EscalaWorkspace>("/api/escalas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", id: base.id, expectedRevision: base.revision, input: draft }), signal: AbortSignal.any([sessionRequests.current.signal, AbortSignal.timeout(30_000)]) }),
    load: id => requestJson<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(id), { signal: AbortSignal.any([sessionRequests.current.signal, AbortSignal.timeout(15_000)]) }),
    onState: state => { if (mounted.current) setSaveState(state); },
    onSaved: (saved, draft, pending) => {
      if (!mounted.current) return;
      generatedReference.current = null; setGenerated(null);
      latestWorkspace.current = saved; latestInput.current = draft; latestDirty.current = pending;
      setWorkspace(saved); setInput(draft); setDirty(pending);
      if (!pending) { setValidation(saved.validation); clearRecovery(saved.id); }
      else setLocalBackup(saveRecovery(saved, draft));
      setWorkspaces(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      setOutdated(previous => previous || hasOutdatedResults(draft, pending ? null : saved.validation));
      setError(""); setProblem(null);
    },
  });

  const saveQueue = saver.current;
  useEffect(() => {
    if (!dirty || !input || !workspace?.canEdit || recovery || busy || !canDisplayEscalaAction(access, "workspace.save", input.branchCode)) return;
    const recoveryTimer = setTimeout(() => {
      if (mounted.current && !accessLocked.current && !unresolvedRecovery.current && saveQueue.hasChanges
        && latestWorkspace.current === workspace && latestInput.current === input) setLocalBackup(saveRecovery(workspace, input));
    }, 250);
    const timer = setTimeout(() => {
      if (!working.current && !recovery && !sessionLocked && saveState === "pending") void saveQueue.flush().catch(cause => {
        if (mounted.current) { const next = toEscalaProblem(cause); setProblem(next); setError(next.message); }
      });
    }, 850);
    return () => { clearTimeout(timer); clearTimeout(recoveryTimer); };
  }, [access, dirty, input, workspace, saveState, recovery, sessionLocked, saveQueue, busy]);

  useEffect(() => {
    const preserve = (event: BeforeUnloadEvent) => {
      if (unresolvedRecovery.current || !latestDirty.current || !latestWorkspace.current || !latestInput.current) return;
      saveRecovery(latestWorkspace.current, latestInput.current);
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", preserve);
    return () => window.removeEventListener("beforeunload", preserve);
  }, []);

  async function flushDraft() {
    if (latestDirty.current && (!latestWorkspace.current?.canEdit || !latestInput.current
      || !canDisplayEscalaAction(access, "workspace.save", latestInput.current.branchCode))) {
      throw new EscalaRequestError("ESCALA_PROTECTED_INPUT", 403, "Esta edição precisa de permissão para salvar. Peça acesso ao administrador ou descarte as alterações.");
    }
    if (recovery) throw new EscalaRequestError("ESCALA_UNSAVED_CHANGES", 0, "Confira o rascunho recuperável antes de continuar.");
    do { await saveQueue.flush(); } while (saveQueue.hasChanges);
    return latestWorkspace.current;
  }

  const refreshIndex = useCallback(async (signal: AbortSignal) => {
    const version = ++indexVersion.current;
    const result = await requestJson<{ workspaces: WorkspaceSummary[]; canCreate: boolean }>("/api/escalas", { signal });
    if (!mounted.current || signal.aborted || version !== indexVersion.current) return;
    setWorkspaces(result.workspaces);
    setCanCreate(result.canCreate);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (sessionRequests.current.signal.aborted) sessionRequests.current = new AbortController();
    const initial = new AbortController();
    const loadSignal = AbortSignal.any([initial.signal, sessionRequests.current.signal]);
    void refreshIndex(loadSignal)
      .catch((cause) => {
        if (!loadSignal.aborted) { const next = toEscalaProblem(cause); setProblem(next); setError(next.message); }
      })
      .finally(() => { if (!loadSignal.aborted && !working.current) setBusy(""); });
    const stopGeneration = () => {
      void generationOperation.current?.cancel().catch(() => undefined);
      controller.current?.abort();
    };
    window.addEventListener("pagehide", stopGeneration);
    return () => {
      if (latestDirty.current && latestWorkspace.current && latestInput.current) saveRecovery(latestWorkspace.current, latestInput.current);
      mounted.current = false;
      sessionRequests.current.abort();
      initial.abort();
      window.removeEventListener("pagehide", stopGeneration);
      stopGeneration();
    };
  }, [refreshIndex]);

  const acceptWorkspace = useCallback((value: EscalaWorkspace, preserveOutdated = false) => {
    const next = parseSavedWorkspace(value);
    selectionEpoch.current += 1;
    setConflict(null);
    setProblem(null);
    setError("");
    latestWorkspace.current = next; latestInput.current = next.input; latestDirty.current = false;
    saveQueue.select(next);
    const recoverable = readRecovery(next);
    unresolvedRecovery.current = recoverable; setRecovery(recoverable);
    setWorkspace(next);
    setInput(next.input);
    setValidation(next.validation);
    setOutdated((previous) => (preserveOutdated && previous) || hasOutdatedResults(next.input, next.validation));
    setDirty(false);
    setResetKey((previous) => previous + 1);
    generatedReference.current = null;
    setGenerated(null);
    setWorkspaces((previous) => [next, ...previous.filter((item) => item.id !== next.id)]);
  }, [saveQueue]);

  const run = useCallback(
    async (
      label: string,
      operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
      canCancel = false,
    ) => {
      if (working.current || sessionRequests.current.signal.aborted) return;
      working.current = true;
      const version = ++requestVersion.current;
      const abort = new AbortController();
      controller.current = abort;
      const isCurrent = () => mounted.current && isCurrentResponse(abort.signal, version, requestVersion.current);
      setBusy(label);
      setCancellable(canCancel);
      setCancelLabel("Cancelar análise");
      setError("");
      setProblem(null);
      setNotice("");
      try {
        await operation(abort.signal, isCurrent);
      } catch (cause) {
        if (isCurrent()) {
          if (invalidatesCandidate(cause)) { generatedReference.current = null; setGenerated(null); }
          const next = toEscalaProblem(cause); setProblem(next); setError(next.message);
        }
      } finally {
        if (mounted.current && version === requestVersion.current) {
          if (generationOperation.current?.cancellationPending) {
            setBusy("O cancelamento ainda não foi confirmado. Confira sua conexão e use Conferir cancelamento. Sua escala foi preservada.");
            setCancellable(true);
            setCancelLabel("Conferir cancelamento");
          } else {
            working.current = false;
            setBusy("");
            setCancellable(false);
            generationOperation.current = null;
            controller.current = null;
          }
        }
      }
    },
    [],
  );

  const update = useCallback((next: EscalaInput) => {
    if (working.current || unresolvedRecovery.current || accessLocked.current || sessionRequests.current.signal.aborted || latestWorkspace.current?.status !== "DRAFT" || !latestWorkspace.current.canEdit
      || !canDisplayEscalaAction(access, "workspace.save", next.branchCode)) return;
    const changed = Boolean(input && scenarioDefinitionChanged(input, next));
    let draft = next;
    // Scoped edits leave protected planning metadata for the server to derive.
    if (isEscalaAdministrator(access)) {
      if (changed && input?.assignments.length && !next.needsRegeneration) draft = { ...draft, needsRegeneration: true };
      if (input && coverageDefinitionChanged(input, next) && next.policy.coverageReview === "CONFIRMED") {
        draft = { ...draft, policy: { ...draft.policy, coverageReview: "SUGGESTED" } };
      }
    }
    latestInput.current = draft; latestDirty.current = true;
    saveQueue.edit(draft);
    setInput(draft);
    if (changed) setOutdated(true);
    setDirty(true);
    setValidation(null);
    generatedReference.current = null;
    setGenerated(null);
    setNotice(changed ? "Cenário alterado. Gere novamente para atualizar horários, folgas e cobertura." : "Alteração aplicada ao rascunho. O salvamento automático atualizará a revisão.");
    setError("");
    setProblem(null);
  }, [access, input, saveQueue]);

  function open(id: string, discard = false) {
    if (pendingNavigation(dirty, Boolean(generated), discard)) {
      setPendingOpen(id);
      return;
    }
    setPendingOpen(null);
    void run("Carregando escala…", async (signal, isCurrent) => {
      const result = await requestJson<EscalaWorkspace>(`/api/escalas?id=${encodeURIComponent(id)}`, { signal });
      if (!isCurrent()) return;
      acceptWorkspace(result);
      if (result.workforce?.needsSync && result.status === "DRAFT" && result.canEdit && !readRecovery(result)) {
        const updated = await post<EscalaWorkspace>({ action: "SYNC_WORKFORCE", id, expectedRevision: result.revision }, signal);
        if (isCurrent()) acceptWorkspace(updated);
      }
    });
  }

  function compareLatest() {
    const current = latestWorkspace.current;
    if (!current) return;
    void run("Consultando a revisão atual sem descartar seu rascunho…", async (signal, isCurrent) => {
      const saved = parseSavedWorkspace(await requestJson<unknown>("/api/escalas?id=" + encodeURIComponent(current.id), { signal }));
      if (!isCurrent()) return;
      if (latestInput.current && sameDraft(saved.input, latestInput.current)) { clearRecovery(saved.id); acceptWorkspace(saved); setNotice("Seu conteúdo já está confirmado na revisão salva."); }
      else setConflict(saved);
    });
  }

  function useServerRevision() {
    if (!conflict) return;
    clearRecovery(conflict.id); acceptWorkspace(conflict); setNotice("Revisão do servidor escolhida explicitamente. A edição anterior não foi sobrescrita no histórico.");
  }

  function rebaseDraft() {
    if (!conflict?.canEdit || !latestInput.current || working.current) return;
    selectionEpoch.current += 1;
    const draft = latestInput.current;
    saveQueue.select(conflict); saveQueue.edit(draft);
    latestWorkspace.current = conflict; latestDirty.current = true;
    generatedReference.current = null; setGenerated(null);
    setWorkspace(conflict); setDirty(true); setConflict(null); setProblem(null); setError("");
    setNotice("Sua edição foi escolhida como conteúdo da próxima revisão. O servidor ainda verificará permissões e dias bloqueados.");
  }

  function saveAndOpen(id: string) {
    saveQueue.retry();
    void run("Salvando antes de abrir outro planejamento…", async (signal, isCurrent) => {
      await flushDraft();
      const result = await requestJson<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(id), { signal });
      if (isCurrent()) { setPendingOpen(null); acceptWorkspace(result); }
    });
  }

  function post<T>(body: Record<string, unknown>, signal: AbortSignal) {
    return requestJson<T>("/api/escalas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: body.action === "CANCEL_GENERATION",
      signal: AbortSignal.any([signal, sessionRequests.current.signal]),
    }).catch(cause => {
      if (body.action === "GENERATE" && cause instanceof EscalaRequestError && cause.status === 413) {
        throw new EscalaRequestError("SOLVER_INPUT_TOO_LARGE", 413, cause.message);
      }
      throw cause;
    });
  }

  async function replaceImport(file: File, command: ImportSyncCommand, externalSignal: AbortSignal): Promise<ImportReplacementResult | null> {
    if (access?.channel !== "ACCOUNT" || !access.administrator || !access.allBranches) throw new Error("Somente o administrador pode importar arquivos.");
    if (working.current || conflict || recovery || generated || !latestWorkspace.current?.canEdit) throw new Error("Conclua a operação, o conflito, o rascunho recuperável ou a proposta pendente antes de importar.");
    const target = latestWorkspace.current;
    if (target.id !== command.workspaceId || target.revision !== command.expectedRevision) throw new Error("O planejamento mudou. Confira o arquivo novamente.");
    let result: ImportReplacementResult | null = null;
    let failure: unknown;
    await run("Conferindo importação administrativa…", async (signal, isCurrent) => {
      try {
        const combined = AbortSignal.any([signal, externalSignal, sessionRequests.current.signal]);
        combined.throwIfAborted();
        if (command.action === "APPLY_REPLACE" && latestDirty.current) throw new Error("Há alterações não salvas. Confira o arquivo novamente após salvar.");
        const saved = await flushDraft();
        combined.throwIfAborted();
        if (!saved || !isCurrent() || saved.id !== target.id) return;
        if (command.action === "APPLY_REPLACE" && saved.revision !== command.expectedRevision) throw new Error("A revisão mudou. Confira o arquivo novamente.");
        const request = { ...command, expectedRevision: saved.revision };
        const received = await requestImportReplacement(file, request, saved, combined);
        if (!isCurrent() || combined.aborted || latestWorkspace.current?.id !== saved.id || latestWorkspace.current.revision !== saved.revision || latestDirty.current) return;
        if ("workspace" in received) {
          clearRecovery(saved.id);
          acceptWorkspace(received.workspace);
          setNotice(`Importação confirmada e salva na revisão ${received.workspace.revision}. Confira a escala; nenhuma publicação foi realizada.`);
        }
        result = received;
      } catch (cause) { failure = cause; }
    });
    if (failure) throw failure;
    return result;
  }

  function create(next: EscalaInput) {
    if (dirty) {
      const next = toEscalaProblem(new EscalaRequestError("ESCALA_UNSAVED_CHANGES", 0, ""));
      setError(next.message);
      setProblem(next);
      return;
    }
    void run("Criando proposta…", async (signal, isCurrent) => {
      const result = await post<EscalaWorkspace>({ action: "CREATE", input: next }, signal);
      if (isCurrent()) {
        acceptWorkspace(result);
        setNotice("Planejamento pronto. Importe a equipe para começar.");
      }
    });
  }

  const { createApproved, addEmployee, removeEmployee, changeAbsence } = workspaceTeamActions({
    workspaceId: workspace?.id, canCreate: !dirty && !generated && !recovery,
    canChangeTeam: !generated && !recovery, run, flushDraft, acceptWorkspace, setNotice,
    absenceTarget: () => {
      const target = latestWorkspace.current;
      return target?.canEdit && target.status === "DRAFT" && target.id === workspace?.id && target.revision === workspace.revision && !latestDirty.current
        && !generated && !recovery && !conflict && saveState === "saved" && !accessLocked.current
        && canDisplayEscalaAction(latestAccess.current, "workspace.save", target.input.branchCode)
        && canDisplayEscalaAction(latestAccess.current, "employee.manage", target.input.branchCode) ? target : null;
    },
  });

  function rebaseApproved(approvedPolicyVersionId: string) {
    if (workspace?.status !== "DRAFT" || dirty || generated || recovery) return;
    void run("Vinculando configuração aprovada…", async (signal, isCurrent) => {
      const result = await operationalCommand({ action: "ADMIN_REBASE", id: workspace.id, expectedRevision: workspace.revision, approvedPolicyVersionId }, signal);
      if (isCurrent()) { acceptWorkspace(result); setNotice("Configuração vinculada em uma nova revisão. Confira os dados e gere outra proposta."); }
    });
  }

  function upgradeCalendar() {
    const selected = latestWorkspace.current;
    if (!isEscalaAdministrator(latestAccess.current)) return;
    if (!selected?.canEdit || !canCreate || working.current || !latestInput.current || !canUpgradePlanningCalendar(latestInput.current)) return;
    void run("Criando rascunho com semanas de domingo a sábado…", async (signal, isCurrent) => {
      const saved = await flushDraft();
      if (!isCurrent() || !isEscalaAdministrator(latestAccess.current) || latestWorkspace.current?.id !== selected.id || !saved) return;
      const result = await post<EscalaWorkspace>({ action: "UPGRADE_CALENDAR", id: saved.id, expectedRevision: saved.revision }, signal);
      if (isCurrent()) { acceptWorkspace(result); setNotice("Novo rascunho de domingo a sábado criado. O planejamento original foi preservado. Gere uma proposta para redistribuir as folgas."); }
    });
  }
  function save() {
    if (!latestWorkspace.current?.canEdit || !latestInput.current
      || !canDisplayEscalaAction(access, "workspace.save", latestInput.current.branchCode)) return;
    saveQueue.retry();
    void run("Conferindo e salvando o rascunho…", async () => {
      generatedReference.current = null; setGenerated(null);
      await flushDraft();
      setNotice("Rascunho salvo e confirmado no servidor. Nenhuma publicação foi realizada.");
    });
  }

  function recoverDraft() {
    if (!recovery || !workspace?.canEdit || working.current) return;
    saveQueue.select(workspace);
    const draft = recovery.input;
    saveQueue.edit(draft);
    latestInput.current = draft; latestDirty.current = true;
    generatedReference.current = null;
    setInput(draft); setDirty(true); setValidation(null); setGenerated(null);
    setOutdated(hasOutdatedResults(draft, null)); setRecovery(null);
    setResetKey(previous => previous + 1);
    setNotice("Rascunho recuperado para edição. A revisão anterior continua no histórico.");
  }

  function ignoreRecovery() { if (workspace) clearRecovery(workspace.id); setRecovery(null); }

  function validate() {
    if (!input || !workspace?.canEdit) return;
    void run("Conferindo jornadas, folgas e cobertura…", async (signal, isCurrent) => {
      const result = await post<EscalaValidation>({ action: "VALIDATE", id: workspace.id, expectedRevision: workspace.revision, input }, signal);
      if (isCurrent()) {
        setValidation(result);
        setNotice("Conferência concluída sobre os dados exibidos. Salve as alterações antes de gerar ou publicar.");
      }
    });
  }

  const approval = workspace as Partial<EscalaWorkspaceAccessMetadata> | null;
  const readOnlyDraft = !isEscalaAdministrator(access) && approval?.approvedPolicyVersionId === null;
  const canGenerate = Boolean(workspace?.status === "DRAFT" && input && !busy && !recovery && !sessionLocked && !readOnlyDraft && !approval?.approvedPolicyRevoked
    && !workspace.workforce?.needsSync && canDisplayEscalaAction(access, "schedule.generate", input.branchCode)
    && (!dirty || workspace.canEdit && canDisplayEscalaAction(access, "workspace.save", input.branchCode)));

  function generate() {
    if (!canGenerate || !workspace || !input || working.current) return;
    const intent = { workspaceId: workspace.id, epoch: selectionEpoch.current };
    const previous = generatedReference.current;
    const sameContext = (value: { workspaceId: string; revision: number; input: EscalaInput }) => latestWorkspace.current?.id === value.workspaceId
      && latestWorkspace.current.revision === value.revision && !latestDirty.current
      && Boolean(latestInput.current && sameDraft(latestInput.current, value.input));
    const usablePrevious = previous?.proposal.validation.valid && sameContext(previous) ? previous : null;
    const restorePrevious = () => {
      if (!usablePrevious || !sameContext(usablePrevious)) return;
      generatedReference.current = usablePrevious;
      setGenerated(usablePrevious.proposal);
    };
    const operation = new GenerationOperation(post);
    generationOperation.current = operation;
    generatedReference.current = null;
    setGenerated(null);
    void run(
      dirty ? "Salvando a equipe antes da análise…" : input.generationMode === "HOURS_ONLY" ? "Preparando horários para toda a filial…" : "Sugerindo folgas para toda a filial…",
      async (signal, isCurrent) => {
        const currentIntent = () => isCurrent() && selectionEpoch.current === intent.epoch
          && latestWorkspace.current?.id === intent.workspaceId;
        let context: { workspaceId: string; revision: number; input: EscalaInput } | null = null;
        try {
          const saved = latestDirty.current ? await flushDraft() : latestWorkspace.current;
          if (!saved || !currentIntent()) return;
          const savedContext = { workspaceId: saved.id, revision: saved.revision, input: structuredClone(saved.input) };
          context = savedContext;
          const currentGeneration = () => currentIntent() && sameContext(savedContext);
          const reference = usablePrevious && sameContext(usablePrevious) && usablePrevious.proposal.candidateReceipt
            ? { input: usablePrevious.proposal.proposalInput, receipt: usablePrevious.proposal.candidateReceipt } : undefined;
          setBusy("Preparando o cálculo da filial…"); setCancellable(true);
          const result = await requestMassGeneration({ workspace: saved, input: saved.input, dirty: false, comparisonReference: reference, signal, isCurrent: currentGeneration, post, operation,
            onSaved: (saved) => acceptWorkspace(saved, true),
            onSolving: () => { setBusy(saved.input.generationMode === "HOURS_ONLY" ? "Conferindo os horários da filial…" : "Sugerindo folgas para toda a filial e conferindo a cobertura…"); setCancellable(true); },
          });
          if (result && currentGeneration()) {
            if (["OPTIMAL", "FEASIBLE"].includes(result.result.status)) {
              generatedReference.current = { ...savedContext, proposal: result };
              setGenerated(result);
              const canApply = Boolean(latestWorkspace.current?.canEdit
                && canDisplayEscalaAction(latestAccess.current, "workspace.save", saved.input.branchCode)
                && canDisplayEscalaAction(latestAccess.current, "schedule.apply", saved.input.branchCode));
              const previewAction = "Confira a proposta. Para aplicar ou salvar alterações, peça ajuda a uma pessoa autorizada nesta filial.";
              const comparisonNotice = result.comparison?.selection === "REFERENCE_RETAINED"
                ? "A proposta anterior foi mantida para preservar a cobertura."
                : result.comparison?.admission === "EXPIRED"
                  ? "A comparação anterior expirou. Uma nova proposta foi calculada."
                  : result.comparison && ["SCENARIO_CHANGED", "INCOMPATIBLE"].includes(result.comparison.admission)
                    ? "A comparação anterior não pôde ser usada neste cenário." : "";
              const warning = result.validation.issues.length ? "Proposta concluída com avisos." : "";
              setNotice(comparisonNotice
                ? [warning, comparisonNotice, canApply ? "Confira antes de aplicar." : previewAction].filter(Boolean).join(" ")
                : `${warning || "Proposta concluída."} ${canApply ? "Confira e aplique à escala." : previewAction}`);
            } else {
              const { status, message, conflicts, rejectionEvidence } = result.result; restorePrevious();
              const problem = solverProblem(status, message, conflicts, rejectionEvidence); setProblem(problem); setNotice(problem?.message ?? "");
            }
          }
        } catch (cause) {
          if (!currentIntent() || (context && !sameContext(context))) return;
          if (!invalidatesCandidate(cause)) restorePrevious();
          throw cause;
        }
      },
      false,
    );
  }

  function applyGenerated() {
    if (!generated || !input || !workspace?.canEdit || working.current || unresolvedRecovery.current || accessLocked.current || sessionLocked || recovery
      || !canDisplayEscalaAction(access, "workspace.save", input.branchCode)
      || !canDisplayEscalaAction(access, "schedule.apply", input.branchCode)) return;
    if (generated.proposalProof && workspace) {
      const candidate = generated;
      const proof = generated.proposalProof;
      const target = workspace;
      void run("Aplicando e salvando a proposta conferida…", async (signal, isCurrent) => {
        const result = await operationalCommand({ action: "APPLY_PROPOSAL", id: target.id, expectedRevision: target.revision,
          input: candidate.proposalInput, proposalProof: proof }, signal);
        if (isCurrent()) { acceptWorkspace(result); setNotice("Proposta aplicada e salva na revisão " + result.revision + ". Nenhuma publicação foi realizada."); }
      });
      return;
    }
    if (access?.channel !== "ACCOUNT" || !access.administrator || !access.allBranches) {
      const next = toEscalaProblem(new EscalaRequestError("ESCALA_PROPOSAL_INVALID", 409, ""));
      setProblem(next); setError(next.message); return;
    }
    const next = generated.proposalInput;
    update(next);
    // Applying a completed, independently validated proposal clears the persisted marker.
    const applied = { ...next, needsRegeneration: false };
    latestInput.current = applied; saveQueue.edit(applied);
    setInput(applied);
    setValidation(generated.validation);
    setOutdated(false);
    setNotice("Proposta aplicada à grade. O rascunho será salvo automaticamente; nenhuma publicação foi realizada.");
  }

  async function undoRoster(previous: EscalaInput, applied: EscalaInput) {
    let restored = false;
    await run("Desfazendo a alteração e conferindo a revisão salva…", async (_signal, isCurrent) => {
      if (!latestInput.current || !isCurrentRosterChange(applied, latestInput.current)) throw new EscalaRequestError("ESCALA_UNDO_STALE", 409, "O cenário mudou depois desta alteração. Confira a grade atual antes de desfazer.");
      saver.current?.retry();
      const saved = await flushDraft();
      if (!saved || !isCurrent() || !isCurrentRosterChange(applied, saved.input)) throw new EscalaRequestError("ESCALA_UNDO_STALE", 409, "A revisão salva mudou. Nenhum desfazer foi aplicado.");
      const before = new Map(previous.assignments.map(day => [day.employeeId + ":" + day.date, day]));
      const unlocked = saved.input.assignments.map(day => {
        const original = before.get(day.employeeId + ":" + day.date);
        return day.locked && !original?.locked ? { ...day, locked: false } : day;
      });
      const needsUnlock = unlocked.some((day, index) => day !== saved.input.assignments[index]);
      const stage = (draft: EscalaInput) => { generatedReference.current = null; setGenerated(null); latestInput.current = draft; latestDirty.current = true; setInput(draft); setDirty(true); saveQueue.edit(draft); setLocalBackup(saveRecovery(latestWorkspace.current ?? saved, draft)); };
      if (needsUnlock) {
        if (!saved.canPublish) throw new EscalaRequestError("ESCALA_UNDO_LOCKED", 403, "Esta edição já foi salva como decisão preservada. Um aprovador precisa desbloqueá-la para desfazer; nenhuma restrição foi removida.");
        // The explicit Undo action follows the existing separate-unlock-and-save contract.
        stage({ ...saved.input, assignments: unlocked });
        await flushDraft();
      }
      stage(previous);
      await flushDraft();
      setOutdated(hasOutdatedResults(previous, latestWorkspace.current?.validation ?? null));
      setNotice("Última alteração desfeita e confirmada no servidor. As revisões anteriores foram preservadas.");
      restored = true;
    });
    return restored;
  }

  function publish(action: "PUBLISH" | "REOPEN_PUBLICATION" = "PUBLISH") {
    const reopen = action === "REOPEN_PUBLICATION";
    if (!workspace?.canPublish || dirty || working.current || (reopen ? workspace.status !== "PUBLISHED" : workspace.workforce?.needsSync || outdated || !validation?.readyToPublish)) return;
    void run(reopen ? "Reabrindo publicação como rascunho…" : "Publicando revisão conferida…", async (signal, isCurrent) => {
      const result = await post<EscalaWorkspace>({ action, id: workspace.id, expectedRevision: workspace.revision }, signal);
      if (isCurrent()) {
        acceptWorkspace(result);
        setNotice(reopen ? "Novo rascunho aberto. A revisão publicada anterior foi preservada." : "Escala publicada internamente. Nenhuma mensagem ou lançamento em folha foi enviado.");
      }
    });
  }

  function deleteWorkspace() {
    if (!workspace?.canEdit) return;
    const deleting = workspace;
    void run("Excluindo planejamento…", async (signal, isCurrent) => {
      const result = await requestJson<{ deletedId: string }>("/api/escalas", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: deleting.id, expectedRevision: deleting.revision }), signal,
      });
      if (isCurrent()) {
        setWorkspaces((previous) => previous.filter((item) => item.id !== result.deletedId));
        setWorkspace(null); setInput(null); setValidation(null); setDirty(false); setOutdated(false);
        generatedReference.current = null;
        setGenerated(null); setPendingOpen(null); setResetKey((previous) => previous + 1);
        setNotice("Planejamento e revisões excluídos. Os demais períodos foram preservados.");
      }
    });
  }

  function discard() {
    if (!workspace || saveState === "saving") return;
    void run("Conferindo a última revisão salva…", async (signal, isCurrent) => {
      const latest = await requestJson<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(workspace.id), { signal });
      if (isCurrent()) { clearRecovery(workspace.id); acceptWorkspace(latest); setNotice("Alterações locais descartadas. Última revisão confirmada no servidor."); }
    });
  }

  function cancelAnalysis() {
    if (!cancellable || cancellationRunning.current) return;
    const operation = generationOperation.current;
    requestVersion.current += 1;
    // Invalidate previews immediately, but keep the workspace busy until the server confirms termination.
    const cancelling = operation?.cancel() ?? Promise.resolve(null);
    controller.current?.abort();
    cancellationRunning.current = true;
    setBusy("Cancelando o cálculo. Sua escala salva será mantida…");
    setCancellable(false);
    setGenerated(null); setProblem(null); setError(""); setNotice("");
    generatedReference.current = null;
    void cancelling.then(status => {
      if (!mounted.current) return;
      generationOperation.current = null; controller.current = null; working.current = false;
      setBusy(""); setCancellable(false); setNotice(generationCancellationNotice(status));
    }).catch(() => {
      if (!mounted.current) return;
      setBusy("O cancelamento ainda não foi confirmado. Confira sua conexão e use Conferir cancelamento. Nenhuma proposta será aplicada.");
      setCancelLabel("Conferir cancelamento"); setCancellable(true);
    }).finally(() => { cancellationRunning.current = false; });
  }

  useEffect(() => {
    const locked = () => {
      accessLocked.current = true;
      if (latestDirty.current && latestWorkspace.current && latestInput.current) saveRecovery(latestWorkspace.current, latestInput.current);
      // Never infer the principal from a name/label. The boundary remounts a fresh scope on re-entry.
      mounted.current = false;
      requestVersion.current += 1;
      selectionEpoch.current += 1;
      generatedReference.current = null; setGenerated(null);
      sessionRequests.current.abort();
      controller.current?.abort();
      const lockedProblem = toEscalaProblem(new EscalaRequestError("ESCALA_ACCESS_REQUIRED", 401, "O acesso expirou. Entre novamente para continuar."));
      setProblem(lockedProblem); setError(lockedProblem.message);
      setSessionLocked(true);
    };
    const unlocked = () => {
      // Re-entry after a lock belongs to a new boundary scope, never this aborted instance.
      if (sessionRequests.current.signal.aborted || accessLocked.current) return;
      setSessionLocked(false);
      saveQueue.retry();
      if (latestDirty.current) save();
      else if (latestWorkspace.current) open(latestWorkspace.current.id);
      else void run("Atualizando planejamentos…", signal => refreshIndex(signal));
    };
    window.addEventListener("escalas:unlocked", unlocked);
    window.addEventListener("escalas:unlock-required", locked);
    return () => { window.removeEventListener("escalas:unlocked", unlocked); window.removeEventListener("escalas:unlock-required", locked); };
  });

  return {
    saveState,
    conflict,
    compareLatest,
    useServerRevision,
    rebaseDraft,
    closeConflict: () => setConflict(null),
    localBackup,
    saveAndOpen,
    isCurrentRevision: (saved: EscalaWorkspace) => latestWorkspace.current?.id === saved.id && latestWorkspace.current.revision === saved.revision && !latestDirty.current && Boolean(latestInput.current && sameDraft(latestInput.current, saved.input)),
    recovery,
    recoverDraft,
    ignoreRecovery,
    flushDraft,
    workspaces,
    canCreate,
    workspace,
    input,
    validation,
    dirty,
    outdated,
    busy,
    error,
    problem,
    notice,
    generated,
    pendingOpen,
    setPendingOpen,
    update,
    open,
    create,
    createApproved,
    addEmployee,
    removeEmployee,
    changeAbsence,
    replaceImport,
    rebaseApproved,
    upgradeCalendar,
    save,
    validate,
    generate,
    canGenerate,
    readOnlyDraft,
    applyGenerated,
    undoRoster,
    publish,
    discard,
    deleteWorkspace,
    resetKey,
    cancellable,
    cancelLabel,
    cancelAnalysis,
    dismissProposals: () => { generatedReference.current = null; setGenerated(null); },
    canEdit: Boolean(workspace?.status === "DRAFT" && workspace.canEdit && !workspace.workforce?.needsSync && !busy && !recovery && !sessionLocked),
  };
}
