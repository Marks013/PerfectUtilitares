import { escalaInputSchema } from "@/lib/escalas/schema";
import type { EscalaInput, EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaRequestError } from "./workspace-feedback-model";

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict" | "invalid";
export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Salvo", pending: "Alterações pendentes", saving: "Salvando…", error: "Falha ao salvar",
  conflict: "Conflito de revisão", invalid: "Complete os campos para salvar",
};

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}

/** Compare persisted meaning, not object key order or server-derived adjacent context. */
export function sameDraft(a: EscalaInput, b: EscalaInput) {
  const clean = (input: EscalaInput) => {
    const parsed = escalaInputSchema.safeParse(input);
    if (!parsed.success) return null;
    const value = parsed.data;
    const referenced = new Set([...value.assignments, ...value.employees.flatMap(person => person.history)].flatMap(day => day.shiftId ? [day.shiftId] : []));
    value.employees.forEach(person => { person.shiftIds.forEach(id => { referenced.add(id); }); });
    return ordered({ ...value, shifts: value.shifts.filter(shift => !shift.id.startsWith("plan-") || referenced.has(shift.id)),
      employees: value.employees.map(person => { const { planningHistory: _history, planningFuture: _future, ...rest } = person; return rest; }) });
  };
  const first = clean(a), second = clean(b);
  return first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second);
}

export function parseSavedWorkspace(value: unknown): EscalaWorkspace {
  const invalid = () => new EscalaRequestError("INVALID_RESPONSE", 0, "A confirmação do servidor está incompleta. O rascunho foi preservado para conferir a gravação.");
  if (!value || typeof value !== "object") throw invalid();
  const data = value as Partial<EscalaWorkspace>;
  const input = escalaInputSchema.safeParse(data.input);
  const validation = data.validation;
  if (!input.success || typeof data.id !== "string" || !data.id || !Number.isInteger(data.revision) || (data.revision ?? 0) < 1
    || !["DRAFT", "PUBLISHED"].includes(data.status ?? "") || typeof data.canEdit !== "boolean" || typeof data.canPublish !== "boolean"
    || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))
    || !validation || typeof validation.valid !== "boolean" || typeof validation.readyToPublish !== "boolean" || !Array.isArray(validation.issues) || !Array.isArray(validation.summaries)) throw invalid();
  return { ...data, input: input.data } as EscalaWorkspace;
}

type SaveAttempt = { base: EscalaWorkspace; input: EscalaInput; version: number; epoch: number };
type Dependencies = {
  send: (base: EscalaWorkspace, input: EscalaInput) => Promise<EscalaWorkspace>;
  load: (id: string) => Promise<EscalaWorkspace>;
  onSaved: (saved: EscalaWorkspace, input: EscalaInput, dirty: boolean) => void;
  onState: (state: SaveState) => void;
};

/** One write at a time; a delayed acknowledgement never replaces a newer draft. */
export class DraftSaveQueue {
  private base: EscalaWorkspace | null = null;
  private input: EscalaInput | null = null;
  private version = 0;
  private epoch = 0;
  private dirty = false;
  private uncertain: SaveAttempt | null = null;
  private pending: Promise<EscalaWorkspace | null> | null = null;
  private pendingEpoch = 0;
  private failure: unknown = null;
  constructor(private readonly deps: Dependencies) {}

  select(workspace: EscalaWorkspace) {
    this.epoch++; this.base = workspace; this.input = workspace.input; this.dirty = false;
    this.uncertain = null; this.failure = null; this.deps.onState("saved");
  }
  edit(input: EscalaInput) {
    this.input = input; this.version++; this.dirty = true;
    if (this.failure instanceof EscalaRequestError && this.failure.code === "ESCALA_INVALID_INPUT") this.failure = null;
    if (!this.failure) this.deps.onState("pending");
  }
  retry() { this.failure = null; }
  get hasChanges() { return this.dirty; }

  private acknowledge(saved: EscalaWorkspace, attempt: SaveAttempt) {
    if (attempt.epoch !== this.epoch) return;
    if (saved.id !== attempt.base.id || saved.input.branchCode !== attempt.input.branchCode || saved.input.startDate !== attempt.input.startDate || saved.input.endDate !== attempt.input.endDate) throw new EscalaRequestError("INVALID_RESPONSE", 0, "A resposta não corresponde ao planejamento. Nenhum conteúdo diferente foi aplicado.");
    this.base = saved;
    this.uncertain = null;
    this.dirty = this.version !== attempt.version;
    if (!this.dirty) this.input = saved.input;
    this.failure = null;
    if (this.input) this.deps.onSaved(saved, this.input, this.dirty);
    this.deps.onState(this.dirty ? "pending" : "saved");
  }

  private async reconcile(attempt: SaveAttempt): Promise<EscalaWorkspace | null> {
    let saved: EscalaWorkspace;
    try { saved = parseSavedWorkspace(await this.deps.load(attempt.base.id)); }
    catch { throw new EscalaRequestError("ESCALA_SAVE_UNCERTAIN", 0, "Não foi possível confirmar a gravação. O rascunho foi preservado; reconecte para conferir antes de tentar novamente."); }
    if (saved.id !== attempt.base.id) throw new EscalaRequestError("INVALID_RESPONSE", 0, "A consulta não corresponde ao planejamento solicitado.");
    if (saved.revision > attempt.base.revision && sameDraft(saved.input, attempt.input)) return saved;
    if (saved.revision === attempt.base.revision && sameDraft(saved.input, attempt.base.input)) return null;
    throw new EscalaRequestError("ESCALA_STALE_REVISION", 409, "Outra revisão foi salva. Seu rascunho foi preservado e não sobrescreverá essa revisão.");
  }

  async flush(): Promise<EscalaWorkspace | null> {
    if (this.pending) {
      const pending = this.pending, pendingEpoch = this.pendingEpoch;
      try { await pending; } catch (cause) { if (this.epoch === pendingEpoch) throw cause; }
      // Selecting another workspace must not strand its dirty draft behind the old write.
      return this.flush();
    }
    if (this.failure) throw this.failure;
    if (!this.base || !this.input || !this.dirty) return this.base;
    if (!escalaInputSchema.safeParse(this.input).success) {
      const error = new EscalaRequestError("ESCALA_INVALID_INPUT", 400, "Complete os campos em edição. Nenhum valor inválido foi salvo.");
      this.failure = error; this.deps.onState("invalid"); throw error;
    }
    const attempt: SaveAttempt = { base: this.base, input: this.input, version: this.version, epoch: this.epoch };
    this.deps.onState("saving");
    this.pendingEpoch = attempt.epoch;
    this.pending = (async () => {
      if (this.uncertain) {
        const previous = this.uncertain;
        const recovered = await this.reconcile(previous);
        this.uncertain = null;
        if (recovered) {
          this.acknowledge(recovered, previous);
          return recovered;
        }
      }
      try {
        const saved = parseSavedWorkspace(await this.deps.send(attempt.base, attempt.input));
        this.acknowledge(saved, attempt);
        return saved;
      } catch (cause) {
        if (attempt.epoch !== this.epoch) throw cause;
        // A 400/403/422 is a definite rejection. Network/5xx/401/409 may need a fresh read.
        if (cause instanceof EscalaRequestError && [400, 403, 422].includes(cause.status)) throw cause;
        this.uncertain = attempt;
        const recovered = await this.reconcile(attempt);
        if (recovered) { this.acknowledge(recovered, attempt); return recovered; }
        this.uncertain = null;
        throw cause;
      }
    })();
    try { return await this.pending; }
    catch (cause) {
      if (attempt.epoch === this.epoch) { this.failure = cause; this.deps.onState(cause instanceof EscalaRequestError && cause.status === 409 ? "conflict" : "error"); }
      throw cause;
    } finally { this.pending = null; }
  }
}
