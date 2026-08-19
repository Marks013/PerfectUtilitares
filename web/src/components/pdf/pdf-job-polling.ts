export type PollablePdfJob<TArtifact> = {
  artifacts: TArtifact[];
  errorCode: string | null;
  errorMessage: string | null;
  progress: number;
  status:
    | "DRAFT"
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
    | "EXPIRED";
};

type ApiError = { error?: { message?: string } };

export class PdfOutputMissingError extends Error {
  constructor() {
    super(
      "O processamento terminou sem gerar um arquivo válido. Reabra o documento e tente novamente. Se o problema continuar, contate o suporte.",
    );
    this.name = "PdfOutputMissingError";
  }
}

function abortError() {
  return new DOMException("Operação cancelada.", "AbortError");
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollPdfJob<TArtifact, TOutput extends TArtifact>({
  isOutput,
  jobId,
  onConnectionIssue,
  onUpdate,
  signal,
}: {
  isOutput: (artifact: TArtifact) => artifact is TOutput;
  jobId: string;
  onConnectionIssue: (message: string | null) => void;
  onUpdate: (job: PollablePdfJob<TArtifact>, outputs: TOutput[]) => void;
  signal: AbortSignal;
}) {
  let consecutiveFailures = 0;

  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/pdf/jobs/${jobId}`, {
        cache: "no-store",
        signal,
      });
      const body = (await response.json()) as
        | { job: PollablePdfJob<TArtifact> }
        | ApiError;
      if (!response.ok || !("job" in body)) {
        const message =
          (body as ApiError).error?.message ??
          "Não foi possível consultar o processamento.";
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new Error(message);
        }
        throw new TypeError(message);
      }

      consecutiveFailures = 0;
      onConnectionIssue(null);
      const outputs = body.job.artifacts.filter(isOutput);
      if (body.job.status === "SUCCEEDED") {
        if (!outputs.length) throw new PdfOutputMissingError();
        onUpdate(body.job, outputs);
        return outputs;
      }
      onUpdate(body.job, outputs);
      if (
        body.job.status === "FAILED" ||
        body.job.status === "CANCELLED" ||
        body.job.status === "EXPIRED"
      ) {
        throw new Error(
          body.job.errorMessage ??
            "Não foi possível concluir o processamento. Confira o arquivo e tente novamente.",
        );
      }
      await wait(1_000, signal);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw abortError();
      if (!(error instanceof TypeError) && !(error instanceof SyntaxError)) {
        throw error;
      }

      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) {
        onConnectionIssue(
          "Conexão com o servidor interrompida. Tentando reconectar sem cancelar o processamento…",
        );
      }
      await wait(Math.min(10_000, 1_000 * 2 ** (consecutiveFailures - 1)), signal);
    }
  }

  throw abortError();
}
