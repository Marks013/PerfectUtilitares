type GenerationState = "CREATED" | "RUNNING" | "CANCEL_REQUESTED" | "CANCELLED" | "COMPLETED" | "FAILED" | "TIMED_OUT";
type GenerationStatus = { operationId: string; state: GenerationState };
type StartedGeneration = GenerationStatus & { expiresAt: string };
type GenerationPost = <T>(body: Record<string, unknown>, signal: AbortSignal) => Promise<T>;
const terminal = new Set<GenerationState>(["CANCELLED", "COMPLETED", "FAILED", "TIMED_OUT"]);
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/** One server operation. Cancel requests never share the aborted calculation signal. */
export class GenerationOperation {
  private creation: Promise<StartedGeneration> | null = null;
  private cancellation: Promise<GenerationStatus | null> | null = null;
  private requested = false;
  private confirmed = false;
  private last: GenerationStatus | null = null;

  constructor(private readonly post: GenerationPost, private readonly wait = pause) {}

  get cancelRequested() { return this.requested; }
  get cancellationPending() { return this.requested && !this.confirmed && this.creation !== null; }

  async start(id: string, expectedRevision: number): Promise<StartedGeneration | null> {
    if (this.requested) return null;
    if (!this.creation) {
      this.creation = this.post<StartedGeneration>({ action: "START_GENERATION", id, expectedRevision }, AbortSignal.timeout(10_000))
        .then(value => {
          if (!value || typeof value.operationId !== "string" || !value.operationId || value.state !== "CREATED") throw new Error("O servidor não confirmou o início do cálculo. Sua escala foi preservada.");
          this.last = value;
          return value;
        });
    }
    try {
      const created = await this.creation;
      if (this.requested) { await this.cancel(); return null; }
      return created;
    } catch (error) {
      if (!this.last) this.creation = null;
      throw error;
    }
  }

  completed() {
    if (!this.requested && this.last) {
      this.last = { operationId: this.last.operationId, state: "COMPLETED" };
      this.confirmed = true;
    }
  }

  cancel(): Promise<GenerationStatus | null> {
    this.requested = true;
    if (this.confirmed) return Promise.resolve(this.last);
    if (!this.creation) { this.confirmed = true; return Promise.resolve(null); }
    if (this.cancellation) return this.cancellation;
    this.cancellation = this.confirmCancellation().finally(() => { this.cancellation = null; });
    return this.cancellation;
  }

  private async confirmCancellation(): Promise<GenerationStatus | null> {
    let created: StartedGeneration;
    try { created = await this.creation as StartedGeneration; }
    catch {
      // GENERATE is never sent without a confirmed ID. A lost START response cannot run the solver.
      this.confirmed = true;
      return null;
    }
    const deadline = Date.now() + 10_000;
    let received = false;
    while (Date.now() < deadline) {
      try {
        const status: GenerationStatus = await this.post<GenerationStatus>({ action: received ? "GENERATION_STATUS" : "CANCEL_GENERATION", operationId: created.operationId }, AbortSignal.timeout(Math.max(1, Math.min(3_000, deadline - Date.now()))));
        if (status.operationId !== created.operationId || !["CREATED", "RUNNING", "CANCEL_REQUESTED", ...terminal].includes(status.state)) throw new Error("Resposta de cancelamento inválida.");
        this.last = status;
        if (terminal.has(status.state)) { this.confirmed = true; return status; }
        received = status.state === "CANCEL_REQUESTED";
      } catch {
        // The first request may have reached the server. Retry the idempotent action, never claim success.
        received = false;
      }
      await this.wait(Math.min(300, Math.max(0, deadline - Date.now())));
    }
    throw new Error("O cancelamento ainda não foi confirmado. Confira sua conexão e use Conferir cancelamento. Nenhuma proposta será aplicada.");
  }
}

export function generationCancellationNotice(status: GenerationStatus | null) {
  if (status?.state === "COMPLETED") return "O cálculo já havia terminado; a proposta não foi aplicada. Sua escala salva foi mantida.";
  if (status?.state === "FAILED" || status?.state === "TIMED_OUT") return "O cálculo foi encerrado no servidor. Nenhuma proposta foi aplicada; você pode tentar novamente.";
  return "Cálculo cancelado. Sua escala salva foi mantida; você pode tentar novamente.";
}
