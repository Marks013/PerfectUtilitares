"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EscalaInput,
  EscalaSolveResult,
  EscalaSuggestion,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { errorMessage, isCurrentResponse, responseMessage } from "./workspace-model";

export type WorkspaceSummary = Pick<EscalaWorkspace, "id" | "revision" | "status" | "updatedAt"> & {
  input: Pick<EscalaInput, "branchCode" | "branchName" | "startDate" | "endDate">;
};
type GeneratedProposal = {
  result: EscalaSolveResult;
  proposalInput: EscalaInput;
  validation: EscalaValidation;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("O servidor não retornou uma resposta válida.");
  }
  if (!response.ok) throw new Error(responseMessage(body));
  return body as T;
}

export function useEscalasWorkspace() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [workspace, setWorkspace] = useState<EscalaWorkspace | null>(null);
  const [input, setInput] = useState<EscalaInput | null>(null);
  const [validation, setValidation] = useState<EscalaValidation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [cancellable, setCancellable] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState<GeneratedProposal | null>(null);
  const [suggestions, setSuggestions] = useState<EscalaSuggestion[]>([]);
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
        setWorkspaces(result.workspaces);
        setCanCreate(result.canCreate);
      })
      .catch((cause) => {
        if (!initial.signal.aborted) setError(errorMessage(cause));
      });
    return () => {
      mounted.current = false;
      initial.abort();
      controller.current?.abort();
    };
  }, []);

  const acceptWorkspace = useCallback((next: EscalaWorkspace) => {
    setWorkspace(next);
    setInput(next.input);
    setValidation(next.validation);
    setDirty(false);
    setResetKey((previous) => previous + 1);
    setGenerated(null);
    setSuggestions([]);
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
      setNotice("");
      try {
        await operation(abort.signal, isCurrent);
      } catch (cause) {
        if (isCurrent()) setError(errorMessage(cause));
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
    setInput(next);
    setDirty(true);
    setValidation(null);
    setGenerated(null);
    setSuggestions([]);
    setNotice("");
    setError("");
  }, []);

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
      setError("Salve ou descarte a proposta atual antes de criar outra escala.");
      return;
    }
    void run("Criando proposta…", async (signal, isCurrent) => {
      const result = await post<EscalaWorkspace>({ action: "CREATE", input: next }, signal);
      if (isCurrent()) {
        acceptWorkspace(result);
        setNotice("Proposta criada. Cadastre a equipe, confira regras e cobertura.");
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
        acceptWorkspace(result);
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
    if (!workspace?.canEdit || dirty) return;
    setGenerated(null);
    setSuggestions([]);
    void run(
      "Gerando proposta e conferindo a equipe…",
      async (signal, isCurrent) => {
        const result = await post<GeneratedProposal>(
          {
            action: "GENERATE",
            id: workspace.id,
            expectedRevision: workspace.revision,
          },
          signal,
        );
        if (isCurrent()) {
          if (["OPTIMAL", "FEASIBLE"].includes(result.result.status)) setGenerated(result);
          else setNotice(result.result.message);
        }
      },
      true,
    );
  }

  function suggest(employeeId: string, weekStart: string) {
    if (!workspace?.canEdit || dirty) return;
    setSuggestions([]);
    setGenerated(null);
    void run(
      "Comparando alternativas com toda a equipe…",
      async (signal, isCurrent) => {
        const result = await post<{ suggestions: EscalaSuggestion[] }>(
          {
            action: "SUGGEST",
            id: workspace.id,
            expectedRevision: workspace.revision,
            employeeId,
            weekStart,
          },
          signal,
        );
        if (isCurrent()) {
          setSuggestions(result.suggestions);
          if (!result.suggestions.length)
            setNotice(
              "Nenhuma alternativa completa foi validada nesta análise. Confira os bloqueios, horários e cobertura.",
            );
        }
      },
      true,
    );
  }

  function applyGenerated() {
    if (!generated || !input) return;
    const next = generated.proposalInput;
    update(next);
    setValidation(generated.validation);
    setNotice("Proposta aplicada à grade. Confira as mudanças e salve a nova revisão.");
  }

  function applySuggestion(suggestion: EscalaSuggestion) {
    if (!input) return;
    update({ ...input, assignments: suggestion.assignments });
    setValidation(suggestion.validation);
    setNotice("Alternativa completa aplicada à proposta. As demais sugestões foram descartadas; confira e salve.");
  }

  function publish() {
    if (!workspace?.canPublish || dirty || !validation?.readyToPublish) return;
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
    setSuggestions([]);
    setNotice(
      "Solicitação cancelada nesta tela. Respostas atrasadas serão ignoradas. O processamento já iniciado no servidor pode terminar dentro do prazo, sem alterar a escala salva.",
    );
  }

  return {
    workspaces,
    canCreate,
    workspace,
    input,
    validation,
    dirty,
    busy,
    error,
    notice,
    generated,
    suggestions,
    pendingOpen,
    setPendingOpen,
    update,
    open,
    create,
    save,
    validate,
    generate,
    suggest,
    applyGenerated,
    applySuggestion,
    publish,
    discard,
    resetKey,
    cancellable,
    cancelAnalysis,
    dismissProposals: () => {
      setGenerated(null);
      setSuggestions([]);
    },
    canEdit: Boolean(workspace?.canEdit && !busy),
  };
}
