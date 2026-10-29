import { escalaInputSchema } from "@/lib/escalas/schema";
import type { EscalaInput, EscalaWorkspace } from "@/lib/escalas/types";
import { sameDraft } from "./draft-persistence";

const PREFIX = "perfectutilitares.escalas.draft:";
const TTL = 8 * 60 * 60_000;
export type RecoverableDraft = { baseRevision: number; input: EscalaInput; savedAt: number };
export function saveRecovery(workspace: EscalaWorkspace, input: EscalaInput) {
  try { sessionStorage.setItem(PREFIX + workspace.id, JSON.stringify({ baseRevision: workspace.revision, input, savedAt: Date.now() })); return true; } catch { return false; }
}
export function clearRecovery(id: string) { try { sessionStorage.removeItem(PREFIX + id); } catch { /* Browser storage is optional. */ } }
export function readRecovery(workspace: EscalaWorkspace): RecoverableDraft | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + workspace.id);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const parsed = escalaInputSchema.safeParse(value.input);
    if (!parsed.success || !Number.isInteger(value.baseRevision) || value.baseRevision < 1 || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > TTL || value.savedAt > Date.now() + 60_000) { clearRecovery(workspace.id); return null; }
    const input = parsed.data;
    if (input.branchCode !== workspace.input.branchCode || input.startDate !== workspace.input.startDate || input.endDate !== workspace.input.endDate) return null;
    if (sameDraft(input, workspace.input)) { clearRecovery(workspace.id); return null; }
    return { ...value, input };
  } catch { return null; }
}
