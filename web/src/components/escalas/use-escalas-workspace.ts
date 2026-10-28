"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EscalaInput,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { coverageDefinitionChanged, errorMessage, isCurrentResponse, responseMessage } from "./workspace-model";
import { requestMassGeneration, type GeneratedProposal } from "./mass-generation";

export type WorkspaceSummary = Pick<EscalaWorkspace, "id" | "revision" | "status" | "updatedAt"> & {
  input: Pick<EscalaInput, "branchCode" | "branchName" | "startDate" | "endDate" | "visibleMonth">;
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
    setInput((previous) => {
      const changedCoverage = previous && coverageDefinitionChanged(previous, next);
      return changedCoverage && next.policy.coverageReview === "CONFIRMED"
        ? { ...next, policy: { ...next.policy, coverageReview: "SUGGESTED" } }
        : next;
    });
    setDirty(true);
    setValidation(null);
    setGenerated(null);
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
        setNotice("Proposta criada. Importe o FPRE136 e peça sugestões para toda a filial.");
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
    if (!workspace?.canEdit || !input) return;
    setGenerated(null);
    void run(
      dirty ? "Salvando a equipe antes da análise…" : "Sugerindo folgas para toda a filial…",
      async (signal, isCurrent) => {
        const result = await requestMassGeneration({ workspace, input, dirty, signal, isCurrent, post,
          onSaved: acceptWorkspace,
          onSolving: () => { setBusy("Sugerindo folgas para toda a filial e conferindo a cobertura…"); setCancellable(true); },
        });
        if (result && isCurrent()) {
          if (["OPTIMAL", "FEASIBLE"].includes(result.result.status)) {
            setGenerated(result);
            setNotice("Sugestão em massa pronta. Confira a prévia e aplique quando desejar.");
          }
          else setNotice(result.result.message);
        }
      },
      !dirty,
    );
  }

  function applyGenerated() {
    if (!generated || !input) return;
    const next = generated.proposalInput;
    update(next);
    setValidation(generated.validation);
    setNotice("Proposta aplicada à grade. Confira as mudanças e salve a nova revisão.");
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
        setWorkspace(null); setInput(null); setValidation(null); setDirty(false);
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
    busy,
    error,
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
