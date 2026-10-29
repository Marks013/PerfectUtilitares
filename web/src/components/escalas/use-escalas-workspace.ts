"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  if (!response.ok) throw new EscalaRequestError(responseCode(body), response.status, responseMessage(body));
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

  const acceptWorkspace = useCallback((next: EscalaWorkspace, preserveOutdated = false) => {
    setProblem(null);
    setError("");
    setWorkspace(next);
    setInput(next.input);
    setValidation(next.validation);
    setOutdated((previous) => (preserveOutdated && previous) || hasOutdatedResults(next.input, next.validation));
    setDirty(false);
    setResetKey((previous) => previous + 1);
    setGenerated(null);
    setWorkspaces((previous) => [next, ...previous.filter((item) => item.id !== next.id)]);
  }, []);

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
    if (working.current) return;
    const changed = Boolean(input && scenarioDefinitionChanged(input, next));
    const changedCoverage = Boolean(input && coverageDefinitionChanged(input, next));
    const needsRegeneration = Boolean(next.needsRegeneration || (changed && input?.assignments.length));
    const marked = Boolean(next.needsRegeneration) === needsRegeneration ? next : { ...next, needsRegeneration };
    setInput(changedCoverage && marked.policy.coverageReview === "CONFIRMED"
      ? { ...marked, policy: { ...marked.policy, coverageReview: "SUGGESTED" } } : marked);
    if (changed) setOutdated(true);
    setDirty(true);
    setValidation(null);
    setGenerated(null);
    setNotice(changed ? "Cenário alterado. Gere novamente para atualizar horários, folgas e cobertura." : "Alteração aplicada ao rascunho. Salve para atualizar a revisão.");
    setError("");
    setProblem(null);
  }, [input]);

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
    if (!workspace || !input || !workspace.canEdit) return;
    void run("Salvando nova revisão…", async (signal, isCurrent) => {
      const result = await post<EscalaWorkspace>(
        {
          action: "SAVE",
          id: workspace.id,
          expectedRevision: workspace.revision,
          input,
        },
        signal,
      );
      if (isCurrent()) {
        acceptWorkspace(result, true);
        setNotice("Revisão salva e conferida. A versão publicada anterior foi preservada.");
      }
    });
  }

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
        const result = await requestMassGeneration({ workspace, input, dirty, signal, isCurrent, post,
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
    setInput((current) => current ? { ...current, needsRegeneration: false } : current);
    setValidation(generated.validation);
    setOutdated(false);
    setNotice("Proposta aplicada à grade. Confira as mudanças e salve a nova revisão.");
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
    if (workspace) {
      acceptWorkspace(workspace);
      setNotice("Alterações locais descartadas. Revisão salva restaurada.");
    }
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

  return {
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
    publish,
    discard,
    deleteWorkspace,
    resetKey,
    cancellable,
    cancelAnalysis,
    dismissProposals: () => {
      setGenerated(null);
    },
    canEdit: Boolean(workspace?.canEdit && !busy),
  };
}
