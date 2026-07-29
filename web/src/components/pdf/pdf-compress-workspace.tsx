"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  Download,
  FileText,
  Loader2,
  Minimize2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

type CompressionQuality = "SCREEN" | "BALANCED" | "PRINT";

type ApiError = {
  error?: { message?: string };
};

type PdfOutput = {
  id: string;
  kind: "OUTPUT";
  originalName: string;
  sizeBytes: string;
};

type PdfJob = {
  errorMessage: string | null;
  progress: number;
  status: string;
  artifacts: Array<PdfOutput | { id: string; kind: string }>;
};

type WorkState = {
  phase: "IDLE" | "UPLOADING" | "QUEUED" | "RUNNING" | "SUCCEEDED";
  progress: number;
  detail: string;
};

const QUALITY_OPTIONS: Array<{
  value: CompressionQuality;
  label: string;
  description: string;
}> = [
  {
    value: "SCREEN",
    label: "Compacto",
    description: "Menor arquivo para tela e envio",
  },
  {
    value: "BALANCED",
    label: "Equilibrado",
    description: "Boa leitura com tamanho reduzido",
  },
  {
    value: "PRINT",
    label: "Impressão",
    description: "Mais detalhes e arquivo maior",
  },
];

function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function uploadPdf(
  jobId: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/pdf/jobs/${jobId}/files`);
    request.setRequestHeader("Content-Type", "application/pdf");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      let body: ApiError | null = null;
      try {
        body = JSON.parse(request.responseText) as ApiError;
      } catch {
        body = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(
          new Error(readApiError(body, `Falha ao enviar ${file.name}.`)),
        );
      }
    });
    request.addEventListener("error", () => {
      reject(new Error(`A conexão foi interrompida ao enviar ${file.name}.`));
    });
    request.send(file);
  });
}

export function PdfCompressWorkspace() {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] =
    useState<CompressionQuality>("BALANCED");
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<PdfOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<WorkState>({
    phase: "IDLE",
    progress: 0,
    detail: "",
  });
  const busy =
    work.phase === "UPLOADING" ||
    work.phase === "QUEUED" ||
    work.phase === "RUNNING";

  useEffect(() => {
    const saved = window.localStorage.getItem("pdf-compression-quality");
    if (saved === "SCREEN" || saved === "BALANCED" || saved === "PRINT") {
      setQuality(saved);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("pdf-compression-quality", quality);
  }, [quality]);

  const onDrop = (acceptedFiles: File[]) => {
    setError(null);
    setOutputs([]);
    setJobId(null);
    setWork({ phase: "IDLE", progress: 0, detail: "" });
    setFiles((current) => {
      const next = new Map(current.map((file) => [getFileKey(file), file]));
      acceptedFiles.forEach((file) => next.set(getFileKey(file), file));
      return [...next.values()].slice(0, 20);
    });
  };

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: { "application/pdf": [".pdf"] },
      disabled: busy,
      maxFiles: 20,
      maxSize: 100 * 1024 * 1024,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "Cada PDF pode ter no máximo 100 MB."
        : "Selecione somente arquivos PDF válidos.",
    );
  }, [fileRejections]);

  const inputBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );
  const outputBytes = useMemo(
    () =>
      outputs.reduce(
        (total, output) => total + Number(output.sizeBytes),
        0,
      ),
    [outputs],
  );
  const savedPercent =
    inputBytes > 0
      ? Math.max(0, Math.round((1 - outputBytes / inputBytes) * 100))
      : 0;

  async function processFiles() {
    if (!files.length || busy) return;

    setError(null);
    setOutputs([]);

    try {
      const createResponse = await fetch("/api/pdf/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "COMPRESS",
          options: { quality },
        }),
      });
      const createBody = (await createResponse.json()) as
        | { job: { id: string } }
        | ApiError;
      if (!createResponse.ok || !("job" in createBody)) {
        throw new Error(
          readApiError(createBody, "Não foi possível iniciar a compressão."),
        );
      }

      const currentJobId = createBody.job.id;
      setJobId(currentJobId);

      for (const [index, file] of files.entries()) {
        setWork({
          phase: "UPLOADING",
          progress: Math.round((index / files.length) * 100),
          detail: `Enviando ${file.name}`,
        });
        await uploadPdf(currentJobId, file, (fileProgress) => {
          setWork({
            phase: "UPLOADING",
            progress: Math.round(
              ((index + fileProgress / 100) / files.length) * 100,
            ),
            detail: `Enviando ${file.name}`,
          });
        });
      }

      const queueResponse = await fetch(
        `/api/pdf/jobs/${currentJobId}/queue`,
        { method: "POST" },
      );
      const queueBody = (await queueResponse.json()) as
        | { job: PdfJob }
        | ApiError;
      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível iniciar a compressão."),
        );
      }

      setWork({
        phase: "QUEUED",
        progress: queueBody.job.progress,
        detail: "Aguardando processamento",
      });

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await wait(1_000);
        const response = await fetch(`/api/pdf/jobs/${currentJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as
          | { job: PdfJob }
          | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível acompanhar a compressão."),
          );
        }

        const nextOutputs = body.job.artifacts.filter(
          (artifact): artifact is PdfOutput => artifact.kind === "OUTPUT",
        );
        if (body.job.status === "SUCCEEDED") {
          setOutputs(nextOutputs);
          setWork({
            phase: "SUCCEEDED",
            progress: 100,
            detail: "Compressão concluída",
          });
          triggerDownload(
            nextOutputs.length > 1
              ? `/api/pdf/jobs/${currentJobId}/outputs/zip`
              : `/api/pdf/jobs/${currentJobId}/outputs/${nextOutputs[0]!.id}`,
          );
          return;
        }

        if (
          body.job.status === "FAILED" ||
          body.job.status === "CANCELLED" ||
          body.job.status === "EXPIRED"
        ) {
          throw new Error(
            body.job.errorMessage ?? "A compressão não pôde ser concluída.",
          );
        }

        setWork({
          phase: body.job.status === "RUNNING" ? "RUNNING" : "QUEUED",
          progress: body.job.progress,
          detail:
            body.job.status === "RUNNING"
              ? "Comprimindo documentos"
              : "Aguardando processamento",
        });
      }

      throw new Error("A compressão demorou além do esperado.");
    } catch (caught) {
      setWork({ phase: "IDLE", progress: 0, detail: "" });
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível comprimir os PDFs.",
      );
    }
  }

  return (
    <div className="pdf-workspace">
      <header className="pdf-workspace__header">
        <div className="pdf-workspace__title">
          <Link href="/pdf" className="pdf-icon-button" title="Voltar">
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span className="sr-only">Voltar às ferramentas</span>
          </Link>
          <div>
            <p className="pdf-eyebrow">Comprimir PDF</p>
            <h1>Reduza arquivos sem perder legibilidade</h1>
          </div>
        </div>
      </header>

      <section className="pdf-compress-settings">
        <div>
          <strong>Qualidade da saída</strong>
          <small>A escolha fica salva neste dispositivo.</small>
        </div>
        <div className="pdf-quality-control" role="radiogroup">
          {QUALITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={quality === option.value}
              data-active={quality === option.value}
              disabled={busy}
              onClick={() => setQuality(option.value)}
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </section>

      <div
        {...getRootProps({
          className: "pdf-dropzone pdf-dropzone--large",
          "data-active": isDragActive,
        })}
      >
        <input {...getInputProps()} />
        <Upload className="size-6" aria-hidden="true" />
        <span>
          Arraste PDFs ou <strong>selecione arquivos</strong>
        </span>
        <small>Até 20 arquivos, com no máximo 100 MB cada</small>
      </div>

      {error ? (
        <div className="pdf-alert pdf-alert--danger" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {files.length ? (
        <section className="pdf-compress-files">
          <header>
            <div>
              <strong>
                {files.length} arquivo{files.length === 1 ? "" : "s"}
              </strong>
              <small>{formatBytes(inputBytes)} no total</small>
            </div>
            <button
              type="button"
              className="pdf-primary-button"
              disabled={busy || work.phase === "SUCCEEDED"}
              onClick={() => void processFiles()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Minimize2 className="size-4" aria-hidden="true" />
              )}
              {busy ? "Processando" : "Comprimir arquivos"}
            </button>
          </header>

          <div className="pdf-compress-file-list">
            {files.map((file) => (
              <div key={getFileKey(file)} className="pdf-compress-file-row">
                <FileText className="size-5" aria-hidden="true" />
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  title={`Remover ${file.name}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter(
                        (item) => getFileKey(item) !== getFileKey(file),
                      ),
                    )
                  }
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {busy ? (
        <section className="pdf-processing-panel" aria-live="polite">
          <div>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>{work.detail}</strong>
              <small>Mantenha esta página aberta até concluir.</small>
            </span>
          </div>
          <div className="pdf-progress-track">
            <span style={{ width: `${work.progress}%` }} />
          </div>
          <b>{work.progress}%</b>
        </section>
      ) : null}

      {outputs.length && jobId ? (
        <section className="pdf-output-panel">
          <div className="pdf-output-panel__heading">
            <span>
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div>
              <strong>Compressão concluída</strong>
              <small>
                {savedPercent > 0
                  ? `${savedPercent}% menor · ${formatBytes(outputBytes)}`
                  : `Melhor tamanho preservado · ${formatBytes(outputBytes)}`}
              </small>
            </div>
          </div>
          <div className="pdf-output-list">
            {outputs.map((output) => (
              <a
                key={output.id}
                href={`/api/pdf/jobs/${jobId}/outputs/${output.id}`}
                className="pdf-output-row"
              >
                <span>
                  <strong>{output.originalName}</strong>
                  <small>{formatBytes(Number(output.sizeBytes))}</small>
                </span>
                <Download className="size-4" aria-hidden="true" />
              </a>
            ))}
          </div>
          {outputs.length > 1 ? (
            <a
              href={`/api/pdf/jobs/${jobId}/outputs/zip`}
              className="pdf-secondary-button"
            >
              <Archive className="size-4" aria-hidden="true" />
              Baixar todos em ZIP
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
