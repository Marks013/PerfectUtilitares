import type { EscalaInput, EscalaSolveResult, EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import { GenerationOperation } from "./generation-operation";

export type GeneratedProposal = {
  result: EscalaSolveResult;
  proposalInput: EscalaInput;
  validation: EscalaValidation;
};

/** Save explicitly selected hours before solving the exact returned revision. */
export async function requestMassGeneration({ workspace, input, dirty, signal, isCurrent, post, onSaved, onSolving, operation = new GenerationOperation(post) }: {
  workspace: EscalaWorkspace;
  input: EscalaInput;
  dirty: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
  post: <T>(body: Record<string, unknown>, signal: AbortSignal) => Promise<T>;
  onSaved: (workspace: EscalaWorkspace) => void;
  onSolving: () => void;
  operation?: GenerationOperation;
}): Promise<GeneratedProposal | null> {
  if (!isCurrent() || signal.aborted) return null;
  let saved = workspace;
  if (dirty) {
    saved = await post<EscalaWorkspace>({ action: "SAVE", id: workspace.id, expectedRevision: workspace.revision, input }, signal);
    if (!isCurrent() || signal.aborted) return null;
    onSaved(saved);
  }
  if (!isCurrent() || signal.aborted) return null;
  const registered = await operation.start(saved.id, saved.revision);
  if (!registered) return null;
  if (!isCurrent() || signal.aborted || operation.cancelRequested) { await operation.cancel(); return null; }
  onSolving();
  try {
    const result = await post<GeneratedProposal>({ action: "GENERATE", id: saved.id, expectedRevision: saved.revision, operationId: registered.operationId }, signal);
    operation.completed();
    if (!isCurrent() || signal.aborted || operation.cancelRequested) { await operation.cancel(); return null; }
    return result;
  } catch (error) {
    await operation.cancel().catch(() => undefined);
    throw error;
  }
}
