import type { EscalaInput, EscalaSolveResult, EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import type { EscalaCandidateReference, EscalaCandidateResponse } from "@/lib/escalas/candidate-reference";
import { GenerationOperation } from "./generation-operation";
import { EscalaRequestError } from "./workspace-feedback-model";

export type GeneratedProposal = EscalaCandidateResponse & {
  result: EscalaSolveResult;
  proposalInput: EscalaInput;
  validation: EscalaValidation;
  proposalProof?: string;
};

/** Save explicitly selected hours before solving the exact returned revision. */
export async function requestMassGeneration({ workspace, input, dirty, comparisonReference, signal, isCurrent, post, onSaved, onSolving, operation = new GenerationOperation(post) }: {
  workspace: EscalaWorkspace;
  input: EscalaInput;
  dirty: boolean;
  comparisonReference?: EscalaCandidateReference;
  signal: AbortSignal;
  isCurrent: () => boolean;
  post: <T>(body: Record<string, unknown>, signal: AbortSignal) => Promise<T>;
  onSaved: (workspace: EscalaWorkspace) => void;
  onSolving: () => void;
  operation?: GenerationOperation;
}): Promise<GeneratedProposal | null> {
  if (!isCurrent() || signal.aborted) return null;
  if (dirty && !workspace.canEdit) throw new EscalaRequestError("ESCALA_PROTECTED_INPUT", 403, "Salve com uma conta autorizada ou descarte as alterações antes de gerar.");
  const reference = !dirty && input.generationMode !== "HOURS_ONLY"
    && comparisonReference?.receipt.workspaceId === workspace.id && comparisonReference.receipt.revision === workspace.revision
    ? structuredClone({ input: comparisonReference.input, receipt: comparisonReference.receipt }) : undefined;
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
    const result = await post<GeneratedProposal>({ action: "GENERATE", id: saved.id, expectedRevision: saved.revision, operationId: registered.operationId,
      ...(reference ? { comparisonReference: reference } : {}),
    }, signal);
    operation.completed();
    if (!isCurrent() || signal.aborted || operation.cancelRequested) { await operation.cancel(); return null; }
    return result;
  } catch (error) {
    await operation.cancel().catch(() => undefined);
    throw error;
  }
}
