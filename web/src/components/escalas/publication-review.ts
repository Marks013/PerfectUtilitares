import type { EscalaInput, EscalaWorkspace } from "@/lib/escalas/types";

export type ReviewedRevision = { workspaceId: string; revision: number; input: EscalaInput };

/** An acknowledgement belongs to the exact saved snapshot, never to a whole branch. */
export function isReviewedRevisionCurrent(review: ReviewedRevision | null, workspace: EscalaWorkspace, dirty: boolean, outdated: boolean): boolean {
  return !dirty && !outdated && review?.workspaceId === workspace.id && review.revision === workspace.revision && review.input === workspace.input;
}
