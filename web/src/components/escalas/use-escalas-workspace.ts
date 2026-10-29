"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftSaveQueue, parseSavedWorkspace, sameDraft, type SaveState } from "./draft-persistence";
import { isCurrentRosterChange } from "./roster-model";
import { clearRecovery, readRecovery, saveRecovery, type RecoverableDraft } from "./draft-recovery";
import type {
  EscalaInput,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { coverageDefinitionChanged, hasOutdatedResults, isCurrentResponse, responseMessage, scenarioDefinitionChanged } from "./workspace-model";
import { requestMassGeneration, type GeneratedProposal } from "./mass-generation";
import { EscalaRequestError, responseCode, solverProblem, toEscalaProblem, type EscalaProblem } from "./workspace-feedback-model";

export type WorkspaceSummary = Pick<EscalaWorkspace, "id" | "revision" | "status" | "updatedAt"> & {
  input: Pick<EscalaInput, "branchCode" | "branchName" | "startDate" | "endDate" | "visibleMonth">;
};
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EscalaRequestError("INVALID_RESPONSE", response.status, "O servidor não retornou uma resposta válida.");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
    throw new EscalaRequestError(responseCode(body), response.status, responseMessage(body));
  }
  return body as T;
}

export function useEscalasWorkspace() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [workspace, setWorkspace] = useState<EscalaWorkspace | null>(null);
  const [input, setInput] = useState<EscalaInput | null>(null);
  const [validation, setValidation] = useState<EscalaValidation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [busy, setBusy] = useState("Carregando planejamentos…");
  const [cancellable, setCancellable] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<EscalaProblem | null>(null);
  const [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState<GeneratedProposal | null>(null);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const working = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [recovery, setRecovery] = useState<RecoverableDraft | null>(null);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [localBackup, setLocalBackup] = useState(true);
  const [conflict, setConflict] = useState<EscalaWorkspace | null>(null);
  const unresolvedRecovery = useRef(recovery);
  unresolvedRecovery.current = recovery;
  const latestWorkspace = useRef(workspace);
  const latestInput = useRef(input);
  const latestDirty = useRef(dirty);
  latestWorkspace.current = workspace; latestInput.current = input; latestDirty.current = dirty;
  const saver = useRef<DraftSaveQueue | null>(null);
  if (!saver.current) saver.current = new DraftSaveQueue({
    send: (base, draft) => requestJson<EscalaWorkspace>("/api/escalas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", id: base.id, expectedRevision: base.revision, input: draft }), signal: AbortSignal.timeout(30_000) }),
    load: id => requestJson<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(id), { signal: AbortSignal.timeout(15_000) }),
    onState: state => { if (mounted.current) setSaveState(state); },
    onSaved: (saved, draft, pending) => {
      if (!mounted.current) return;
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
    if (!dirty || !input || !workspace?.canEdit || recovery || busy) return;
    const recoveryTimer = setTimeout(() => setLocalBackup(saveRecovery(workspace, input)), 250);
    const timer = setTimeout(() => {
      if (!working.current && !recovery && !sessionLocked && saveState === "pending") void saveQueue.flush().catch(cause => {
        if (mounted.current) { const next = toEscalaProblem(cause); setProblem(next); setError(next.message); }
      });
    }, 850);
    return () => { clearTimeout(timer); clearTimeout(recoveryTimer); };
  }, [dirty, input, workspace, saveState, recovery, sessionLocked, saveQueue, busy]);

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
    if (recovery) throw new EscalaRequestError("ESCALA_UNSAVED_CHANGES", 0, "Confira o rascunho recuperável antes de continuar.");
    do { await saveQueue.flush(); } while (saveQueue.hasChanges);
    return latestWorkspace.current;
  }

  useEffect(() => {
    mounted.current = true;
    const initial = new AbortController();
    void requestJson<{ workspaces: WorkspaceSummary[]; canCreate: boolean }>("/api/escalas", { signal: initial.signal })
      .then((result) => {
        if (initial.signal.aborted) return;
        setWorkspaces(result.workspaces);
        setCanCreate(result.canCreate);
      })
      .catch((cause) => {
        if (!initial.signal.aborted) { const next = toEscalaProblem(cause); setProblem(next); setError(next.message); }
      })
      .finally(() => { if (!initial.signal.aborted && !working.current) setBusy(""); });
    return () => {
      mounted.current = false;
      initial.abort();
      controller.current?.abort();
    };
  }, []);

  const acceptWorkspace = useCallback((value: EscalaWorkspace, preserveOutdated = false) => {
    const next = parseSavedWorkspace(value);
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
    setGenerated(null);
    setWorkspaces((previous) => [next, ...previous.filter((item) => item.id !== next.id)]);
  }, [saveQueue]);

  const run = useCallback(
    async (
      label: string,
      operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
      canCancel = false,
    ) => {
      if (working.current) return;
      working.current = true;
      const version = ++requestVersion.current;
      const abort = new AbortController();
      controller.current = abort;
      const isCurrent = () => mounted.current && isCurrentResponse(abort.signal, version, requestVersion.current);
      setBusy(label);
      setCancellable(canCancel);
      setError("");
      setProblem(null);
      setNotice("");
      try {
        await operation(abort.signal, isCurrent);
      } catch (cause) {
        if (isCurrent()) { const next = toEscalaProblem(cause); setProblem(next); setError(next.message); }
      } finally {
        if (mounted.current && version === requestVersion.current) {
          working.current = false;
          setBusy("");
          setCancellable(false);
          controller.current = null;
        }
      }
    },
    [],
  );

  const update = useCallback((next: EscalaInput) => {
    if (working.current || unresolvedRecovery.current) return;
    const changed = Boolean(input && scenarioDefinitionChanged(input, next));
    const changedCoverage = Boolean(input && coverageDefinitionChanged(input, next));
    const needsRegeneration = Boolean(next.needsRegeneration || (changed && input?.assignments.length));
    const marked = Boolean(next.needsRegeneration) === needsRegeneration ? next : { ...next, needsRegeneration };
    const draft = changedCoverage && marked.policy.coverageReview === "CONFIRMED"
      ? { ...marked, policy: { ...marked.policy, coverageReview: "SUGGESTED" as const } } : marked;
    latestInput.current = draft; latestDirty.current = true;
    saveQueue.edit(draft);
    setInput(draft);
    if (changed) setOutdated(true);
    setDirty(true);
    setValidation(null);
    setGenerated(null);
    setNotice(changed ? "Cenário alterado. Gere novamente para atualizar horários, folgas e cobertura." : "Alteração aplicada ao rascunho. O salvamento automático atualizará a revisão.");
    setError("");
    setProblem(null);
  }, [input, saveQueue]);

  function open(id: string, discard = false) {
    if (dirty && !discard) {
      setPendingOpen(id);
      return;
    }
    setPendingOpen(null);
    void run("Carregando escala…", async (signal, isCurrent) => {
      const result = await requestJson<EscalaWorkspace>(`/api/escalas?id=${encodeURIComponent(id)}`, { signal });
      if (isCurrent()) acceptWorkspace(result);
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
    const draft = latestInput.current;
    saveQueue.select(conflict); saveQueue.edit(draft);
    latestWorkspace.current = conflict; latestDirty.current = true;
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
      signal,
    });
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

  function save() {
    if (!latestWorkspace.current?.canEdit) return;
    saveQueue.retry();
    void run("Conferindo e salvando o rascunho…", async () => {
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
    setInput(draft); setDirty(true); setValidation(null); setGenerated(null);
    setOutdated(hasOutdatedResults(draft, null)); setRecovery(null);
    setResetKey(previous => previous + 1);
    setNotice("Rascunho recuperado para edição. A revisão anterior continua no histórico.");
  }

  function ignoreRecovery() { if (workspace) clearRecovery(workspace.id); setRecovery(null); }

  function validate() {
    if (!input || !workspace?.canEdit) return;
    void run("Conferindo jornadas, folgas e cobertura…", async (signal, isCurrent) => {
      const result = await post<EscalaValidation>({ action: "VALIDATE", input }, signal);
      if (isCurrent()) {
        setValidation(result);
        setNotice("Conferência concluída sobre os dados exibidos. Salve as alterações antes de gerar ou publicar.");
      }
    });
  }

  function generate() {
    if (!workspace?.canEdit || !input) return;
    setGenerated(null);
    void run(
      dirty ? "Salvando a equipe antes da análise…" : "Sugerindo folgas para toda a filial…",
      async (signal, isCurrent) => {
        const saved = await flushDraft();
        if (!saved || !isCurrent()) return;
        const result = await requestMassGeneration({ workspace: saved, input: saved.input, dirty: false, signal, isCurrent, post,
          onSaved: (saved) => acceptWorkspace(saved, true),
          onSolving: () => { setBusy("Sugerindo folgas para toda a filial e conferindo a cobertura…"); setCancellable(true); },
        });
        if (result && isCurrent()) {
          if (["OPTIMAL", "FEASIBLE"].includes(result.result.status)) {
            setGenerated(result);
            setNotice(result.validation.issues.length ? "Proposta concluída com avisos. Confira e aplique à escala." : "Proposta concluída. Confira e aplique à escala.");
          }
          else { setProblem(solverProblem(result.result.status, result.result.message, result.result.conflicts)); setNotice(result.result.message); }
        }
      },
      !dirty,
    );
  }

  function applyGenerated() {
    if (!generated || !input) return;
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
      const stage = (draft: EscalaInput) => { latestInput.current = draft; latestDirty.current = true; setInput(draft); setDirty(true); saveQueue.edit(draft); setLocalBackup(saveRecovery(latestWorkspace.current ?? saved, draft)); };
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

  function publish() {
    if (!workspace?.canPublish || dirty || outdated || !validation?.readyToPublish) return;
    void run("Publicando revisão conferida…", async (signal, isCurrent) => {
      const result = await post<EscalaWorkspace>(
        {
          action: "PUBLISH",
          id: workspace.id,
          expectedRevision: workspace.revision,
        },
        signal,
      );
      if (isCurrent()) {
        acceptWorkspace(result);
        setNotice("Escala publicada internamente. Nenhuma mensagem ou lançamento em folha foi enviado.");
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
    if (!cancellable) return;
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    working.current = false;
    setBusy("");
    setCancellable(false);
    setGenerated(null);
    setProblem(null);
    setError("");
    setNotice(
      "Análise cancelada. A equipe salva antes da análise foi preservada. Respostas atrasadas serão ignoradas e nenhuma sugestão será aplicada.",
    );
  }

  useEffect(() => {
    const locked = () => setSessionLocked(true);
    const unlocked = () => {
      setSessionLocked(false);
      saveQueue.retry();
      if (latestDirty.current) save();
      else if (latestWorkspace.current) open(latestWorkspace.current.id);
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
    save,
    validate,
    generate,
    applyGenerated,
    undoRoster,
    publish,
    discard,
    deleteWorkspace,
    resetKey,
    cancellable,
    cancelAnalysis,
    dismissProposals: () => {
      setGenerated(null);
    },
    canEdit: Boolean(workspace?.canEdit && !busy && !recovery),
  };
}
