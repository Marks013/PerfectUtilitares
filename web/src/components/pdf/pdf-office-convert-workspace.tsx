"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";

type OfficeOperation =
  | "WORD_TO_PDF"
  | "EXCEL_TO_PDF";
type ApiError = { error?: { message?: string } };
type OutputArtifact = {
  id: string;
  kind: "OUTPUT";
  originalName: string;
  sizeBytes: string;
};
type JobResult = {
  errorMessage: string | null;
  progress: number;
  status: string;
  artifacts: Array<OutputArtifact | { id: string; kind: string }>;
};

const CONVERTERS: Record<
  OfficeOperation,
  {
    accept: Record<string, string[]>;
    description: string;
    extension: string;
    inputLabel: string;
    mimeType: string;
    outputLabel: string;
    title: string;
    uploadRoute: "documents" | "files";
  }
> = {
  WORD_TO_PDF: {
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
    },
    description:
      "Converta documentos Word em PDF preservando o layout de impressão.",
    extension: ".docx",
    inputLabel: "Word",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    outputLabel: "PDF",
    title: "Word para PDF",
    uploadRoute: "documents",
  },
  EXCEL_TO_PDF: {
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
    },
    description:
      "Converta planilhas Excel em PDF usando a configuração de impressão.",
    extension: ".xlsx",
    inputLabel: "Excel",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    outputLabel: "PDF",
    title: "Excel para PDF",
    uploadRoute: "documents",
  },
};

function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(value: number | string) {
  const bytes = Number(value);
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function createJob(operation: OfficeOperation) {
  const response = await fetch("/api/pdf/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation }),
  });
  const body = (await response.json()) as
    | { job: { id: string } }
    | ApiError;
  if (!response.ok || !("job" in body)) {
    throw new Error(readApiError(body, "Não foi possível iniciar a conversão."));
  }
  return body.job.id;
}

function uploadFile({
  file,
  jobId,
  mimeType,
  onProgress,
  route,
}: {
  file: File;
  jobId: string;
  mimeType: string;
  onProgress: (progress: number) => void;
  route: "documents" | "files";
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/pdf/jobs/${jobId}/${route}`);
    request.setRequestHeader("Content-Type", mimeType);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      let body: ApiError | null = null;
      try {
        body = JSON.parse(request.responseText) as ApiError;
      } catch {
        body = null;
      }
      reject(
        new Error(
          readApiError(body, `Não foi possível enviar “${file.name}”.`),
        ),
      );
    });
    request.addEventListener("error", () => {
      reject(new Error("A conexão foi interrompida durante o envio."));
    });
    request.send(file);
  });
}

export function PdfOfficeConvertWorkspace({
  operation,
}: {
  operation: OfficeOperation;
}) {
  const converter = CONVERTERS[operation];
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "IDLE" | "UPLOADING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"
  >("IDLE");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("");
  const [outputs, setOutputs] = useState<OutputArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const locked =
    phase === "UPLOADING" || phase === "QUEUED" || phase === "RUNNING";

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    setOutputs([]);
    setPhase("IDLE");
    setFiles((current) => {
      const existing = new Set(current.map(fileKey));
      return [
        ...current,
        ...acceptedFiles.filter((file) => !existing.has(fileKey(file))),
      ].slice(0, 20);
    });
  }, []);

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: converter.accept,
      disabled: locked,
      maxFiles: 20,
      maxSize: 100 * 1024 * 1024,
      multiple: true,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "Cada arquivo pode ter no máximo 100 MB."
        : `Selecione arquivos ${converter.extension} válidos.`,
    );
  }, [converter.extension, fileRejections]);

  async function convert() {
    if (!files.length) return;
    setError(null);
    setOutputs([]);
    setPhase("UPLOADING");
    setProgress(0);

    try {
      const currentJobId = await createJob(operation);
      setJobId(currentJobId);
      for (const [index, file] of files.entries()) {
        setDetail(`Enviando ${file.name}`);
        await uploadFile({
          file,
          jobId: currentJobId,
          mimeType: converter.mimeType,
          route: converter.uploadRoute,
          onProgress(uploadProgress) {
            setProgress(
              Math.round(
                ((index + uploadProgress / 100) / files.length) * 45,
              ),
            );
          },
        });
      }

      setPhase("QUEUED");
      setDetail("Preparando conversão");
      setProgress(48);
      const queueResponse = await fetch(
        `/api/pdf/jobs/${currentJobId}/queue`,
        { method: "POST" },
      );
      const queueBody = (await queueResponse.json()) as
        | { job: JobResult }
        | ApiError;
      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível iniciar a conversão."),
        );
      }

      for (let attempt = 0; attempt < 360; attempt += 1) {
        await wait(1_000);
        const response = await fetch(`/api/pdf/jobs/${currentJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as
          | { job: JobResult }
          | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível acompanhar a conversão."),
          );
        }
        const currentOutputs = body.job.artifacts.filter(
          (artifact): artifact is OutputArtifact => artifact.kind === "OUTPUT",
        );
        setPhase(
          body.job.status === "QUEUED"
            ? "QUEUED"
            : body.job.status === "RUNNING"
              ? "RUNNING"
              : body.job.status === "SUCCEEDED"
                ? "SUCCEEDED"
                : "FAILED",
        );
        setDetail(
          body.job.status === "QUEUED"
            ? "Aguardando processamento"
            : "Convertendo arquivos",
        );
        setProgress(48 + Math.round(body.job.progress * 0.52));
        setOutputs(currentOutputs);

        if (body.job.status === "SUCCEEDED") {
          setDetail("Conversão concluída");
          setProgress(100);
          if (currentOutputs.length === 1) {
            triggerDownload(
              `/api/pdf/jobs/${currentJobId}/outputs/${currentOutputs[0]!.id}`,
            );
          } else if (currentOutputs.length > 1) {
            triggerDownload(`/api/pdf/jobs/${currentJobId}/outputs/zip`);
          }
          return;
        }
        if (
          body.job.status === "FAILED" ||
          body.job.status === "CANCELLED" ||
          body.job.status === "EXPIRED"
        ) {
          throw new Error(
            body.job.errorMessage ?? "Não foi possível concluir a conversão.",
          );
        }
      }
      throw new Error("A conversão demorou mais do que o esperado.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir a conversão.",
      );
      setPhase("FAILED");
    }
  }

  function reset() {
    setFiles([]);
    setJobId(null);
    setOutputs([]);
    setPhase("IDLE");
    setProgress(0);
    setDetail("");
    setError(null);
  }

  const InputIcon = operation === "EXCEL_TO_PDF" ? FileSpreadsheet : FileText;

  return (
    <div className="pdf-workspace pdf-convert-workspace">
      <header className="pdf-workspace__header">
        <div>
          <Link href="/pdf" className="pdf-back-link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Ferramentas PDF
          </Link>
          <p className="pdf-eyebrow">Conversor de documentos</p>
          <h1>{converter.title}</h1>
        </div>
        <p>{converter.description}</p>
      </header>

      <div
        {...getRootProps()}
        className="pdf-dropzone pdf-convert-dropzone"
        data-active={isDragActive}
      >
        <input {...getInputProps()} />
        <Upload className="size-7" aria-hidden="true" />
        <strong>
          Solte {converter.inputLabel === "PDF" ? "os PDFs" : "os arquivos"} aqui
        </strong>
        <span>ou selecione até 20 arquivos {converter.extension}</span>
      </div>

      {files.length ? (
        <section className="pdf-convert-files">
          <header>
            <div>
              <h2>Arquivos selecionados</h2>
              <span>{files.length} de 20</span>
            </div>
            <button type="button" disabled={locked} onClick={() => setFiles([])}>
              <Trash2 className="size-4" aria-hidden="true" />
              Limpar
            </button>
          </header>
          <div>
            {files.map((file) => (
              <article key={fileKey(file)}>
                <span className="pdf-convert-file__icon">
                  <InputIcon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  title="Remover arquivo"
                  disabled={locked}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((item) => fileKey(item) !== fileKey(file)),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {locked || phase === "SUCCEEDED" ? (
        <section className="pdf-convert-progress" aria-live="polite">
          <div>
            {phase === "SUCCEEDED" ? (
              <Check className="size-5" aria-hidden="true" />
            ) : (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            )}
            <span>
              <strong>{detail}</strong>
              <small>{progress}%</small>
            </span>
          </div>
          <div className="pdf-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        </section>
      ) : null}

      {outputs.length && jobId ? (
        <section className="pdf-output-panel">
          <div className="pdf-output-panel__heading">
            <Check className="size-5" aria-hidden="true" />
            <div>
              <strong>Arquivos prontos</strong>
              <span>Baixe individualmente ou reúna tudo em ZIP.</span>
            </div>
          </div>
          <div className="pdf-output-list">
            {outputs.map((output) => (
              <button
                key={output.id}
                type="button"
                onClick={() =>
                  triggerDownload(
                    `/api/pdf/jobs/${jobId}/outputs/${output.id}`,
                  )
                }
              >
                <Download className="size-4" aria-hidden="true" />
                <span>{output.originalName}</span>
                <small>{formatBytes(output.sizeBytes)}</small>
              </button>
            ))}
          </div>
          {outputs.length > 1 ? (
            <button
              type="button"
              className="pdf-zip-button"
              onClick={() =>
                triggerDownload(`/api/pdf/jobs/${jobId}/outputs/zip`)
              }
            >
              <Archive className="size-4" aria-hidden="true" />
              Baixar ZIP
            </button>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="pdf-workspace__error" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="pdf-workspace__footer">
        <div>
          <span>
            {files.length
              ? `${files.length} arquivo${files.length === 1 ? "" : "s"} para converter`
              : `Adicione arquivos ${converter.extension}`}
          </span>
        </div>
        <div>
          {phase === "SUCCEEDED" || phase === "FAILED" ? (
            <button
              type="button"
              className="pdf-secondary-action"
              onClick={reset}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Nova conversão
            </button>
          ) : null}
          <button
            type="button"
            className="pdf-primary-action"
            disabled={!files.length || locked || phase === "SUCCEEDED"}
            onClick={() => void convert()}
          >
            {locked ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            Converter para {converter.outputLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
