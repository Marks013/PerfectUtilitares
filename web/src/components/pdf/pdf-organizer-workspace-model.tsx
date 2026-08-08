"use client";

import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Check,
  Copy,
  GripVertical,
  MoreVertical,
  RotateCw,
  Trash2,
} from "lucide-react";
import type {
  MouseEvent,
} from "react";
import { PdfPageThumbnail } from "@/components/pdf/pdf-page-thumbnail";
import {
  configurePdfJsClient,
  pdfJsClientUrlOptions,
} from "@/lib/pdf/pdfjs-client";
export type PageRotation = 0 | 90 | 180 | 270;

export type WorkspacePage = {
  id: string;
  artifactId: string;
  fileName: string;
  sourcePage: number;
  rotation: PageRotation;
  crop?: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  cropMargins?: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
};

export type UploadState = {
  fileName: string;
  progress: number;
} | null;

export type ApiError = {
  error?: { message?: string };
};

export type PdfOutput = {
  id: string;
  kind: "OUTPUT";
  mimeType: string;
  originalName: string;
  sizeBytes: string;
};

export type PdfJobResult = {
  id: string;
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
  artifacts: Array<
    PdfOutput | { id: string; kind: string; originalName: string }
  >;
};

export type RecoverableJob = Omit<PdfJobResult, "artifacts"> & {
  operation: string;
  options: unknown;
  artifacts: Array<{
    id: string;
    kind: string;
    mimeType: string;
    originalName: string;
  }>;
};

export type ProcessingState = {
  status: PdfJobResult["status"] | "IDLE";
  progress: number;
  outputs: PdfOutput[];
};

export type StructuralPdfOperation =
  | "MERGE"
  | "SPLIT"
  | "ROTATE"
  | "DELETE_PAGES"
  | "EXTRACT_PAGES"
  | "CROP"
  | "PDF_TO_JPG"
  | "ORGANIZE";

export const WORKSPACE_COPY: Record<
  StructuralPdfOperation,
  {
    eyebrow: string;
    title: string;
    emptyTitle: string;
    emptyDescription: string;
    finishLabel: string;
  }
> = {
  MERGE: {
    eyebrow: "Juntar PDF",
    title: "Combine documentos na ordem certa",
    emptyTitle: "Adicione os PDFs que serão unidos",
    emptyDescription:
      "As páginas aparecerão juntas para você conferir e ordenar.",
    finishLabel: "Juntar PDFs",
  },
  SPLIT: {
    eyebrow: "Dividir PDF",
    title: "Separe cada página em um novo PDF",
    emptyTitle: "Adicione o PDF que será dividido",
    emptyDescription:
      "Organize ou exclua páginas antes de gerar os arquivos individuais.",
    finishLabel: "Dividir PDF",
  },
  ROTATE: {
    eyebrow: "Girar PDF",
    title: "Corrija a orientação das páginas",
    emptyTitle: "Adicione o PDF que será girado",
    emptyDescription: "Selecione uma ou várias páginas e ajuste a orientação.",
    finishLabel: "Salvar PDF girado",
  },
  DELETE_PAGES: {
    eyebrow: "Excluir páginas",
    title: "Remova páginas antes de salvar",
    emptyTitle: "Adicione o PDF que será ajustado",
    emptyDescription:
      "Selecione as páginas desnecessárias e use o botão Excluir.",
    finishLabel: "Salvar sem as páginas",
  },
  EXTRACT_PAGES: {
    eyebrow: "Extrair páginas",
    title: "Monte um PDF apenas com as páginas necessárias",
    emptyTitle: "Adicione o PDF de origem",
    emptyDescription:
      "Exclua o que não será extraído e organize as páginas restantes.",
    finishLabel: "Extrair páginas",
  },
  CROP: {
    eyebrow: "Recortar PDF",
    title: "Ajuste a área visível das páginas",
    emptyTitle: "Adicione o PDF que será recortado",
    emptyDescription:
      "Selecione páginas, ajuste as margens e confira a área preservada.",
    finishLabel: "Salvar PDF recortado",
  },
  PDF_TO_JPG: {
    eyebrow: "PDF para JPG",
    title: "Transforme páginas em imagens JPG",
    emptyTitle: "Adicione o PDF que será convertido",
    emptyDescription:
      "Organize ou exclua páginas antes de gerar as imagens individuais.",
    finishLabel: "Converter para JPG",
  },
  ORGANIZE: {
    eyebrow: "Organizar PDF",
    title: "Monte o documento na ordem certa",
    emptyTitle: "Adicione o primeiro PDF",
    emptyDescription:
      "As páginas aparecerão aqui para você arrastar, selecionar e reorganizar.",
    finishLabel: "Finalizar PDF",
  },
};

export function readApiError(value: unknown, fallback: string) {
  const body = value as ApiError | null;
  return body?.error?.message ?? fallback;
}

export function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function createOrganizerJob(operation: StructuralPdfOperation) {
  const response = await fetch("/api/pdf/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation }),
  });
  const body = (await response.json()) as { job: { id: string } } | ApiError;

  if (!response.ok || !("job" in body)) {
    throw new Error(readApiError(body, "Não foi possível iniciar o trabalho."));
  }

  return body.job.id;
}

export function uploadPdf(
  jobId: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<string>((resolve, reject) => {
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
      let body: { artifactId?: unknown; error?: { message?: string } } | null =
        null;
      try {
        body = JSON.parse(request.responseText) as {
          artifactId?: unknown;
          error?: { message?: string };
        };
      } catch {
        body = null;
      }

      if (
        request.status >= 200 &&
        request.status < 300 &&
        typeof body?.artifactId === "string"
      ) {
        resolve(body.artifactId);
        return;
      }

      reject(
        new Error(
          readApiError(body, "Não foi possível enviar o arquivo selecionado."),
        ),
      );
    });

    request.addEventListener("error", () => {
      reject(new Error("A conexão foi interrompida durante o envio."));
    });

    request.send(file);
  });
}

export async function loadPdfDocument(jobId: string, artifactId: string) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfJsClient(pdfjs);
  return pdfjs.getDocument(
    pdfJsClientUrlOptions(`/api/pdf/jobs/${jobId}/inputs/${artifactId}`),
  ).promise;
}

export function nextRotation(rotation: PageRotation): PageRotation {
  return ((rotation + 90) % 360) as PageRotation;
}

export type SortablePageProps = {
  page: WorkspacePage;
  document: PDFDocumentProxy | undefined;
  index: number;
  selected: boolean;
  menuOpen: boolean;
  locked: boolean;
  onSelect: (event: MouseEvent, id: string) => void;
  onMenu: (id: string | null) => void;
  onRotate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

export function SortablePage({
  page,
  document,
  index,
  selected,
  menuOpen,
  locked,
  onSelect,
  onMenu,
  onRotate,
  onDuplicate,
  onDelete,
}: SortablePageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled: locked });

  return (
    <article
      ref={setNodeRef}
      className="pdf-page-card"
      data-selected={selected}
      data-dragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div className="pdf-page-card__toolbar">
        <button
          type="button"
          className="pdf-page-card__drag"
          title="Arrastar página"
          aria-label={`Mover página ${index + 1}`}
          disabled={locked}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <span>Página {index + 1}</span>
        <button
          type="button"
          className="pdf-page-card__menu-button"
          title="Ações da página"
          aria-expanded={menuOpen}
          disabled={locked}
          onClick={(event) => {
            event.stopPropagation();
            onMenu(menuOpen ? null : page.id);
          }}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="pdf-page-card__select"
        aria-label={`Selecionar página ${index + 1}: ${page.fileName}`}
        aria-pressed={selected}
        disabled={locked}
        onClick={(event) => onSelect(event, page.id)}
      />
      <PdfPageThumbnail
        document={document}
        pageNumber={page.sourcePage}
        rotation={page.rotation}
        cropMargins={page.cropMargins}
      />

      <footer className="pdf-page-card__footer">
        <span title={page.fileName}>{page.fileName}</span>
        {page.rotation ? <small>{page.rotation}°</small> : null}
      </footer>

      {selected ? (
        <span className="pdf-page-card__selected">
          <Check className="size-4" aria-hidden="true" />
          <span className="sr-only">Selecionada</span>
        </span>
      ) : null}

      {menuOpen ? (
        <div
          className="pdf-page-menu"
          role="menu"
        >
          <button type="button" onClick={() => onRotate(page.id)}>
            <RotateCw className="size-4" aria-hidden="true" />
            Girar
          </button>
          <button type="button" onClick={() => onDuplicate(page.id)}>
            <Copy className="size-4" aria-hidden="true" />
            Duplicar
          </button>
          <button
            type="button"
            className="pdf-page-menu__danger"
            onClick={() => onDelete(page.id)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Excluir
          </button>
        </div>
      ) : null}
    </article>
  );
}
