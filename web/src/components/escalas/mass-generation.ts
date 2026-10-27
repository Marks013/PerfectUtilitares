import type { EscalaInput, EscalaSolveResult, EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";

export type GeneratedProposal = {
  result: EscalaSolveResult;
  proposalInput: EscalaInput;
  validation: EscalaValidation;
};

/** Save explicitly selected hours before solving the exact returned revision. */
export async function requestMassGeneration({ workspace, input, dirty, signal, isCurrent, post, onSaved, onSolving }: {
  workspace: EscalaWorkspace;
  input: EscalaInput;
  dirty: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
  post: <T>(body: Record<string, unknown>, signal: AbortSignal) => Promise<T>;
  onSaved: (workspace: EscalaWorkspace) => void;
  onSolving: () => void;
}): Promise<GeneratedProposal | null> {
  if (!isCurrent() || signal.aborted) return null;
  let saved = workspace;
  if (dirty) {
    saved = await post<EscalaWorkspace>({ action: "SAVE", id: workspace.id, expectedRevision: workspace.revision, input }, signal);
    if (!isCurrent() || signal.aborted) return null;
    onSaved(saved);
  }
  if (!isCurrent() || signal.aborted) return null;
  onSolving();
  const result = await post<GeneratedProposal>({ action: "GENERATE", id: saved.id, expectedRevision: saved.revision }, signal);
  return isCurrent() && !signal.aborted ? result : null;
}
