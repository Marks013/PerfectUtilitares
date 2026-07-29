"use client";

import {
  Archive,
  Download,
  FileClock,
  FileText,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type HistoryArtifact = {
  id: string;
  kind: "INPUT" | "OUTPUT";
  originalName: string;
  sizeBytes: string;
};

export type PdfHistoryItem = {
  id: string;
  operation: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  artifacts: HistoryArtifact[];
};

const OPERATION_LABELS: Record<string, string> = {
  ANNOTATE: "PDF anotado",
  COMPRESS: "PDF comprimido",
  CROP: "PDF recortado",
  DELETE_PAGES: "Páginas excluídas",
  EDIT: "PDF editado",
  EXCEL_TO_PDF: "Excel para PDF",
  EXTRACT_PAGES: "Páginas extraídas",
  JPG_TO_PDF: "JPG para PDF",
  MERGE: "PDFs unidos",
  ORGANIZE: "PDF organizado",
  PDF_TO_EXCEL: "PDF para Excel",
  PDF_TO_JPG: "PDF para JPG",
  PDF_TO_WORD: "PDF para Word",
  ROTATE: "PDF girado",
  SPLIT: "PDF dividido",
  WORD_TO_PDF: "Word para PDF",
};

const STATUS_LABELS: Record<string, string> = {
  CANCELLED: "Cancelado",
  DRAFT: "Rascunho",
  EXPIRED: "Expirado",
  FAILED: "Falhou",
  QUEUED: "Na fila",
  RUNNING: "Processando",
  SUCCEEDED: "Concluído",
};

const DRAFT_ROUTES: Partial<Record<string, string>> = {
  ANNOTATE: "/pdf/anotar",
  CROP: "/pdf/recortar",
  DELETE_PAGES: "/pdf/excluir-paginas",
  EDIT: "/pdf/editar",
  EXTRACT_PAGES: "/pdf/extrair-paginas",
  MERGE: "/pdf/juntar",
  ORGANIZE: "/pdf/organizar",
  PDF_TO_JPG: "/pdf/para-jpg",
  ROTATE: "/pdf/girar",
  SPLIT: "/pdf/dividir",
};

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatBytes(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
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

export function PdfHistoryList({
  initialItems,
}: {
  initialItems: PdfHistoryItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !items.some((item) => item.status === "QUEUED" || item.status === "RUNNING")
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetch("/api/pdf/jobs", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { jobs?: PdfHistoryItem[] };
          if (!body.jobs) return;
          setItems(
            body.jobs.map((job) => ({
              ...job,
              artifacts: job.artifacts.filter(
                (artifact) =>
                  artifact.kind === "INPUT" || artifact.kind === "OUTPUT",
              ),
            })),
          );
        })
        .catch(() => undefined);
    }, 2_000);

    return () => window.clearInterval(timer);
  }, [items]);

  async function deleteJob(id: string) {
    if (!window.confirm("Excluir este trabalho e todos os arquivos gerados?")) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/pdf/jobs/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Não foi possível excluir.");
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível excluir.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (!items.length) {
    return (
      <div className="pdf-history-empty">
        <FileClock className="size-8" aria-hidden="true" />
        <strong>Nenhum trabalho PDF</strong>
        <span>Arquivos processados aparecerão aqui.</span>
      </div>
    );
  }

  return (
    <div className="pdf-history">
      {error ? (
        <div className="pdf-workspace__error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="pdf-history__list">
        {items.map((item) => {
          const inputs = item.artifacts.filter(
            (artifact) => artifact.kind === "INPUT",
          );
          const outputs = item.artifacts.filter(
            (artifact) => artifact.kind === "OUTPUT",
          );
          return (
            <article key={item.id} className="pdf-history-item">
              <div className="pdf-history-item__icon">
                <FileText className="size-5" aria-hidden="true" />
              </div>
              <div className="pdf-history-item__body">
                <div className="pdf-history-item__heading">
                  <div>
                    <strong>
                      {OPERATION_LABELS[item.operation] ?? "Trabalho PDF"}
                    </strong>
                    <span>
                      {HISTORY_DATE_FORMATTER.format(new Date(item.createdAt))}
                    </span>
                  </div>
                  <span
                    className="pdf-history-status"
                    data-status={item.status.toLowerCase()}
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </div>
                <div className="pdf-history-files">
                  {outputs.length
                    ? outputs.map((artifact) => (
                        <button
                          key={artifact.id}
                          type="button"
                          onClick={() =>
                            triggerDownload(
                              `/api/pdf/jobs/${item.id}/outputs/${artifact.id}`,
                            )
                          }
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          <span>{artifact.originalName}</span>
                          <small>{formatBytes(artifact.sizeBytes)}</small>
                        </button>
                      ))
                    : inputs.slice(0, 3).map((artifact) => (
                        <div key={artifact.id}>
                          <FileText className="size-3.5" aria-hidden="true" />
                          <span>{artifact.originalName}</span>
                          <small>{formatBytes(artifact.sizeBytes)}</small>
                        </div>
                      ))}
                </div>
                {item.status === "RUNNING" || item.status === "QUEUED" ? (
                  <div className="pdf-history-progress">
                    <div className="pdf-progress">
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                    <span>{item.progress}%</span>
                  </div>
                ) : null}
                {item.status === "FAILED" && item.errorMessage ? (
                  <p className="pdf-history-item__error">{item.errorMessage}</p>
                ) : null}
              </div>
              <div className="pdf-history-item__actions">
                {item.status === "DRAFT" && DRAFT_ROUTES[item.operation] ? (
                  <Link
                    href={`${DRAFT_ROUTES[item.operation]}?job=${encodeURIComponent(item.id)}`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    <span>Continuar</span>
                  </Link>
                ) : null}
                {outputs.length > 1 ? (
                  <button
                    type="button"
                    title="Baixar todos em ZIP"
                    onClick={() =>
                      triggerDownload(
                        `/api/pdf/jobs/${item.id}/outputs/zip`,
                      )
                    }
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    <span>ZIP</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pdf-history-delete"
                  title="Excluir trabalho"
                  disabled={deletingId === item.id || item.status === "RUNNING"}
                  onClick={() => void deleteJob(item.id)}
                >
                  {deletingId === item.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  <span>Excluir</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
