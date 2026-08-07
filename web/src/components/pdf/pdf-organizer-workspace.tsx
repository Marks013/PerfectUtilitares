"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  Crop,
  Download,
  GripVertical,
  Loader2,
  MoreVertical,
  Redo2,
  RotateCw,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useDropzone } from "react-dropzone";
import { PdfPageThumbnail } from "@/components/pdf/pdf-page-thumbnail";
import { isAbortError, pollPdfJob } from "@/components/pdf/pdf-job-polling";
import { PdfVisualCropEditor } from "@/components/pdf/pdf-visual-crop-editor";
import {
  combinePageRotation,
  displayMarginsToSource,
  sourceMarginsToDisplay,
} from "@/lib/pdf/geometry";
import {
  configurePdfJsClient,
  pdfJsClientUrlOptions,
} from "@/lib/pdf/pdfjs-client";

type PageRotation = 0 | 90 | 180 | 270;

type WorkspacePage = {
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

type UploadState = {
  fileName: string;
  progress: number;
} | null;

type ApiError = {
  error?: { message?: string };
};

type PdfOutput = {
  id: string;
  kind: "OUTPUT";
  mimeType: string;
  originalName: string;
  sizeBytes: string;
};

type PdfJobResult = {
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

type RecoverableJob = Omit<PdfJobResult, "artifacts"> & {
  operation: string;
  options: unknown;
  artifacts: Array<{
    id: string;
    kind: string;
    mimeType: string;
    originalName: string;
  }>;
};

type ProcessingState = {
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

const WORKSPACE_COPY: Record<
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

function readApiError(value: unknown, fallback: string) {
  const body = value as ApiError | null;
  return body?.error?.message ?? fallback;
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function createOrganizerJob(operation: StructuralPdfOperation) {
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

function uploadPdf(
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

async function loadPdfDocument(jobId: string, artifactId: string) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfJsClient(pdfjs);
  return pdfjs.getDocument(
    pdfJsClientUrlOptions(`/api/pdf/jobs/${jobId}/inputs/${artifactId}`),
  ).promise;
}

function nextRotation(rotation: PageRotation): PageRotation {
  return ((rotation + 90) % 360) as PageRotation;
}

type SortablePageProps = {
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

function SortablePage({
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

export function PdfOrganizerWorkspace({
  operation = "ORGANIZE",
}: {
  operation?: StructuralPdfOperation;
}) {
  const copy = WORKSPACE_COPY[operation];
  const documents = useRef(new Map<string, PDFDocumentProxy>());
  const recoveryStarted = useRef(false);
  const processingAbort = useRef<AbortController | null>(null);
  const past = useRef<WorkspacePage[][]>([]);
  const future = useRef<WorkspacePage[][]>([]);
  const lastSelectedIndex = useRef<number | null>(null);
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuPageId, setMenuPageId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [processing, setProcessing] = useState<ProcessingState>({
    status: "IDLE",
    progress: 0,
    outputs: [],
  });
  const [cropMargins, setCropMargins] = useState({
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  });
  const [historyVersion, setHistoryVersion] = useState(0);
  const processingLocked =
    processing.status === "QUEUED" ||
    processing.status === "RUNNING" ||
    processing.status === "SUCCEEDED";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(
    () => () => {
      processingAbort.current?.abort();
    },
    [],
  );

  const commitPages = useCallback(
    (update: (current: WorkspacePage[]) => WorkspacePage[]) => {
      setPages((current) => {
        const next = update(current);
        if (next === current) return current;
        past.current = [...past.current.slice(-39), current];
        future.current = [];
        setHistoryVersion((version) => version + 1);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (recoveryStarted.current) return;
    recoveryStarted.current = true;
    const recoveredJobId = new URLSearchParams(window.location.search).get(
      "job",
    );
    if (!recoveredJobId) return;

    async function recoverDraft() {
      setUpload({ fileName: "Recuperando rascunho", progress: 0 });
      setError(null);
      try {
        const response = await fetch(`/api/pdf/jobs/${recoveredJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as
          { job: RecoverableJob } | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível recuperar o rascunho."),
          );
        }
        if (body.job.status !== "DRAFT" || body.job.operation !== operation) {
          throw new Error("Este rascunho não pode mais ser alterado.");
        }

        const options =
          body.job.options && typeof body.job.options === "object"
            ? (body.job.options as {
                manifest?: {
                  version: 1;
                  pages: Array<Omit<WorkspacePage, "cropMargins" | "fileName">>;
                };
              })
            : {};
        const savedPages = options.manifest?.pages ?? [];
        const inputs = body.job.artifacts.filter(
          (artifact) => artifact.kind === "INPUT",
        );
        if (!savedPages.length || !inputs.length) {
          throw new Error("Rascunho não possui páginas salvas.");
        }

        const inputNames = new Map(
          inputs.map((artifact) => [artifact.id, artifact.originalName]),
        );
        for (const [index, input] of inputs.entries()) {
          setUpload({
            fileName: input.originalName,
            progress: Math.round((index / inputs.length) * 100),
          });
          documents.current.set(
            input.id,
            await loadPdfDocument(body.job.id, input.id),
          );
        }

        const recoveredPages = await Promise.all(
          savedPages.map(async (page) => {
            const document = documents.current.get(page.artifactId);
            const sourcePage = document
              ? await document.getPage(page.sourcePage)
              : null;
            let cropMargins: WorkspacePage["cropMargins"];
            if (page.crop && sourcePage) {
              const sourceWidth = sourcePage.view[2] - sourcePage.view[0];
              const sourceHeight = sourcePage.view[3] - sourcePage.view[1];
              cropMargins = sourceMarginsToDisplay(
                combinePageRotation(sourcePage.rotate, page.rotation),
                {
                  left: (page.crop.x / sourceWidth) * 100,
                  right:
                    ((sourceWidth - page.crop.x - page.crop.width) /
                      sourceWidth) *
                    100,
                  bottom: (page.crop.y / sourceHeight) * 100,
                  top:
                    ((sourceHeight - page.crop.y - page.crop.height) /
                      sourceHeight) *
                    100,
                },
              );
            }
            return {
              ...page,
              cropMargins,
              fileName: inputNames.get(page.artifactId) ?? "documento.pdf",
            };
          }),
        );
        setJobId(body.job.id);
        setPages(recoveredPages);
        setSelectedIds(new Set());
        setSaveState("saved");
        setProcessing({ outputs: [], progress: 0, status: "IDLE" });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível recuperar o rascunho.",
        );
      } finally {
        setUpload(null);
      }
    }

    void recoverDraft();
  }, [operation]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      setError(null);

      try {
        let currentJobId = jobId;
        if (!currentJobId) {
          currentJobId = await createOrganizerJob(operation);
          setJobId(currentJobId);
        }

        for (const file of acceptedFiles) {
          setUpload({ fileName: file.name, progress: 0 });
          const artifactId = await uploadPdf(currentJobId, file, (progress) =>
            setUpload({ fileName: file.name, progress }),
          );
          const document = await loadPdfDocument(currentJobId, artifactId);
          documents.current.set(artifactId, document);

          const importedPages = Array.from(
            { length: document.numPages },
            (_, index): WorkspacePage => ({
              id: crypto.randomUUID(),
              artifactId,
              fileName: file.name,
              sourcePage: index + 1,
              rotation: 0,
            }),
          );

          commitPages((current) => [...current, ...importedPages]);
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível abrir os arquivos selecionados.",
        );
      } finally {
        setUpload(null);
      }
    },
    [commitPages, jobId, operation],
  );

  const { getInputProps, getRootProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: { "application/pdf": [".pdf"] },
      maxFiles: 20,
      maxSize: 100 * 1024 * 1024,
      disabled: Boolean(upload) || processingLocked,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    const firstError = fileRejections[0]?.errors[0];
    setError(
      firstError?.code === "file-too-large"
        ? "Cada PDF pode ter no máximo 100 MB."
        : "Selecione arquivos PDF válidos.",
    );
  }, [fileRejections]);

  const persistManifest = useCallback(async () => {
    if (!jobId || !pages.length) {
      throw new Error("Adicione ao menos uma página ao documento.");
    }
    setSaveState("saving");
    const response = await fetch(`/api/pdf/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: {
          version: 1,
          pages: pages.map((page) => ({
            id: page.id,
            artifactId: page.artifactId,
            sourcePage: page.sourcePage,
            rotation: page.rotation,
            crop: page.crop,
          })),
        },
      }),
    });

    if (!response.ok) {
      const body = (await response.json()) as ApiError;
      setSaveState("error");
      throw new Error(
        readApiError(body, "Não foi possível salvar a organização."),
      );
    }

    setSaveState("saved");
  }, [jobId, pages]);

  useEffect(() => {
    if (!jobId || !pages.length || processingLocked) return;

    const timer = window.setTimeout(() => {
      void persistManifest().catch(() => undefined);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [jobId, pages, persistManifest, processingLocked]);

  function handleSelect(event: MouseEvent, id: string) {
    const index = pages.findIndex((page) => page.id === id);
    const additive = event.ctrlKey || event.metaKey;
    const previousIndex = lastSelectedIndex.current;
    const ranged = event.shiftKey && previousIndex !== null;

    setSelectedIds((current) => {
      if (ranged && previousIndex !== null) {
        const start = Math.min(previousIndex, index);
        const end = Math.max(previousIndex, index);
        return new Set(pages.slice(start, end + 1).map((page) => page.id));
      }

      if (additive) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }

      return new Set([id]);
    });

    lastSelectedIndex.current = index;
    setMenuPageId(null);
    if (operation === "CROP") {
      setCropMargins(
        pages[index]?.cropMargins ?? { bottom: 0, left: 0, right: 0, top: 0 },
      );
    }
  }

  function rotate(ids: Set<string>) {
    if (!ids.size) return;
    commitPages((current) =>
      current.map((page) =>
        ids.has(page.id)
          ? { ...page, rotation: nextRotation(page.rotation) }
          : page,
      ),
    );
    setMenuPageId(null);
  }

  function remove(ids: Set<string>) {
    if (!ids.size) return;
    commitPages((current) => current.filter((page) => !ids.has(page.id)));
    setSelectedIds(new Set());
    setMenuPageId(null);
  }

  function duplicate(ids: Set<string>) {
    if (!ids.size) return;
    commitPages((current) => {
      const next: WorkspacePage[] = [];
      for (const page of current) {
        next.push(page);
        if (ids.has(page.id)) {
          next.push({ ...page, id: crypto.randomUUID() });
        }
      }
      return next;
    });
    setMenuPageId(null);
  }

  async function applyCrop(ids: Set<string>) {
    if (!ids.size) {
      setError("Selecione ao menos uma página para aplicar o recorte.");
      return;
    }

    try {
      const crops = new Map<string, NonNullable<WorkspacePage["crop"]>>();
      for (const page of pages) {
        if (!ids.has(page.id)) continue;
        const document = documents.current.get(page.artifactId);
        if (!document) {
          throw new Error(
            `A página de “${page.fileName}” não está disponível.`,
          );
        }
        const sourcePage = await document.getPage(page.sourcePage);
        const sourceRotation = combinePageRotation(
          sourcePage.rotate,
          page.rotation,
        );
        const sourceMargins = displayMarginsToSource(
          sourceRotation,
          cropMargins,
        );
        const sourceWidth = sourcePage.view[2] - sourcePage.view[0];
        const sourceHeight = sourcePage.view[3] - sourcePage.view[1];
        const width =
          sourceWidth * (1 - (sourceMargins.left + sourceMargins.right) / 100);
        const height =
          sourceHeight * (1 - (sourceMargins.top + sourceMargins.bottom) / 100);
        if (width <= 0 || height <= 0) {
          throw new Error(
            "A área mantida precisa ter largura e altura maiores que zero.",
          );
        }
        crops.set(page.id, {
          x: sourceWidth * (sourceMargins.left / 100),
          y: sourceHeight * (sourceMargins.bottom / 100),
          width,
          height,
        });
      }

      commitPages((current) =>
        current.map((page) =>
          ids.has(page.id)
            ? {
                ...page,
                crop: crops.get(page.id),
                cropMargins: { ...cropMargins },
              }
            : page,
        ),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível aplicar o recorte. Tente novamente.",
      );
    }
  }

  function undo() {
    const previous = past.current.at(-1);
    if (!previous) return;
    setPages((current) => {
      future.current = [current, ...future.current.slice(0, 39)];
      return previous;
    });
    past.current = past.current.slice(0, -1);
    setSelectedIds(new Set());
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    const next = future.current[0];
    if (!next) return;
    setPages((current) => {
      past.current = [...past.current.slice(-39), current];
      return next;
    });
    future.current = future.current.slice(1);
    setSelectedIds(new Set());
    setHistoryVersion((version) => version + 1);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;

    const overId = event.over.id;

    commitPages((current) => {
      const from = current.findIndex((page) => page.id === event.active.id);
      const to = current.findIndex((page) => page.id === overId);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }

  async function finalizePdf() {
    if (!jobId || !pages.length || processingLocked || upload) return;

    processingAbort.current?.abort();
    const controller = new AbortController();
    processingAbort.current = controller;
    setError(null);
    setProcessing({ status: "QUEUED", progress: 0, outputs: [] });

    try {
      await persistManifest();
      const queueResponse = await fetch(`/api/pdf/jobs/${jobId}/queue`, {
        method: "POST",
        signal: controller.signal,
      });
      const queueBody = (await queueResponse.json()) as
        { job: PdfJobResult } | ApiError;

      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível iniciar o processamento."),
        );
      }

      setProcessing({
        status:
          queueBody.job.status === "SUCCEEDED"
            ? "RUNNING"
            : queueBody.job.status,
        progress: queueBody.job.progress,
        outputs: [],
      });

      const outputs = await pollPdfJob<
        PdfJobResult["artifacts"][number],
        PdfOutput
      >({
        jobId,
        signal: controller.signal,
        isOutput: (artifact): artifact is PdfOutput =>
          artifact.kind === "OUTPUT",
        onConnectionIssue(message) {
          setError(
            (current) =>
              message ??
              (current?.startsWith("Conexão com o servidor interrompida")
                ? null
                : current),
          );
        },
        onUpdate(job, validOutputs) {
          setProcessing({
            status: job.status,
            progress: job.progress,
            outputs: validOutputs,
          });
        },
      });
      const firstOutput = outputs[0];

      if (!firstOutput) {
        throw new Error("O processamento terminou sem gerar um arquivo.");
      }

      const downloadUrl =
        outputs.length > 1
          ? `/api/pdf/jobs/${jobId}/outputs/zip`
          : `/api/pdf/jobs/${jobId}/outputs/${firstOutput.id}`;
      triggerDownload(downloadUrl);
    } catch (caught) {
      if (isAbortError(caught)) return;
      setProcessing((current) => ({
        ...current,
        status: "FAILED",
      }));
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir o PDF.",
      );
    } finally {
      if (processingAbort.current === controller) {
        processingAbort.current = null;
      }
    }
  }

  const selected = useMemo(
    () => pages.filter((page) => selectedIds.has(page.id)),
    [pages, selectedIds],
  );
  const activePage = pages.find((page) => page.id === activeId);
  const cropPreviewPage = selected[0] ?? pages[0];

  return (
    <div className="pdf-workspace">
      <header className="pdf-workspace__header">
        <div className="pdf-workspace__title">
          <Link href="/pdf" className="pdf-icon-button" title="Voltar">
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span className="sr-only">Voltar às ferramentas</span>
          </Link>
          <div>
            <p className="pdf-eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
          </div>
        </div>

        <div className="pdf-workspace__status" aria-live="polite">
          {saveState === "saving" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Salvando
            </>
          ) : null}
          {saveState === "saved" ? (
            <>
              <Save className="size-4" aria-hidden="true" />
              Alterações salvas
            </>
          ) : null}
          {saveState === "error" ? "Falha ao salvar" : null}
        </div>
      </header>

      <div className="pdf-workspace__toolbar">
        <div className="pdf-toolbar-group">
          <button
            type="button"
            className="pdf-icon-button"
            onClick={undo}
            disabled={!past.current.length || processingLocked}
            title="Desfazer"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            <span className="sr-only">Desfazer</span>
          </button>
          <button
            type="button"
            className="pdf-icon-button"
            onClick={redo}
            disabled={!future.current.length || processingLocked}
            title="Refazer"
          >
            <Redo2 className="size-4" aria-hidden="true" />
            <span className="sr-only">Refazer</span>
          </button>
          <span className="sr-only">{historyVersion}</span>
        </div>

        <div className="pdf-toolbar-group pdf-toolbar-group--selection">
          <span>
            {selected.length
              ? `${selected.length} selecionada${selected.length > 1 ? "s" : ""}`
              : `${pages.length} página${pages.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={() => rotate(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <RotateCw className="size-4" aria-hidden="true" />
            Girar
          </button>
          <button
            type="button"
            onClick={() => duplicate(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <Copy className="size-4" aria-hidden="true" />
            Duplicar
          </button>
          <button
            type="button"
            className="pdf-danger-button"
            onClick={() => remove(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Excluir
          </button>
          {selectedIds.size ? (
            <button
              type="button"
              className="pdf-icon-button"
              onClick={() => setSelectedIds(new Set())}
              title="Limpar seleção"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Limpar seleção</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="pdf-primary-button"
          disabled={!pages.length || Boolean(upload) || processingLocked}
          onClick={() => void finalizePdf()}
        >
          {processing.status === "QUEUED" || processing.status === "RUNNING" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {processing.status === "QUEUED"
            ? "Na fila"
            : processing.status === "RUNNING"
              ? `Processando ${processing.progress}%`
              : processing.status === "SUCCEEDED"
                ? "PDF concluído"
                : copy.finishLabel}
        </button>
      </div>

      {operation === "CROP" && pages.length ? (
        <section className="pdf-crop-controls">
          <header>
            <div>
              <strong>Área que será mantida</strong>
              <small>
                Ajuste com o mouse, toque, teclado ou campos numéricos. A área
                escura será removida.
              </small>
            </div>
            <div>
              <button
                type="button"
                disabled={processingLocked || !selectedIds.size}
                onClick={() => void applyCrop(selectedIds)}
              >
                <Crop className="size-4" aria-hidden="true" />
                Aplicar nas selecionadas
              </button>
              <button
                type="button"
                disabled={processingLocked}
                onClick={() =>
                  void applyCrop(new Set(pages.map((page) => page.id)))
                }
              >
                Aplicar em todas
              </button>
            </div>
          </header>
          {cropPreviewPage ? (
            <PdfVisualCropEditor
              disabled={processingLocked}
              document={documents.current.get(cropPreviewPage.artifactId)}
              margins={cropMargins}
              onChange={setCropMargins}
              pageNumber={cropPreviewPage.sourcePage}
              rotation={cropPreviewPage.rotation}
            />
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="pdf-alert pdf-alert--danger" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {processing.status === "QUEUED" || processing.status === "RUNNING" ? (
        <section className="pdf-processing-panel" aria-live="polite">
          <div>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>
                {processing.status === "QUEUED"
                  ? "Aguardando processamento"
                  : "Preparando documento"}
              </strong>
              <small>
                Você pode acompanhar o avanço sem recarregar a página.
              </small>
            </span>
          </div>
          <div
            className="pdf-progress-track"
            role="progressbar"
            aria-label="Progresso do PDF"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={processing.progress}
          >
            <span style={{ width: `${processing.progress}%` }} />
          </div>
          <b>{processing.progress}%</b>
        </section>
      ) : null}

      {processing.status === "SUCCEEDED" && processing.outputs.length ? (
        <section className="pdf-output-panel" aria-live="polite">
          <div className="pdf-output-panel__heading">
            <span>
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div>
              <strong>
                {processing.outputs.length === 1
                  ? "PDF pronto"
                  : `${processing.outputs.length} PDFs prontos`}
              </strong>
              <small>Downloads disponíveis durante 30 minutos.</small>
            </div>
          </div>

          <div className="pdf-output-list">
            {processing.outputs.map((output) => (
              <a
                key={output.id}
                href={`/api/pdf/jobs/${jobId}/outputs/${output.id}`}
                className="pdf-output-row"
              >
                <span>
                  <strong>{output.originalName}</strong>
                  <small>
                    {(Number(output.sizeBytes) / 1024 / 1024).toFixed(2)} MB
                  </small>
                </span>
                <Download className="size-4" aria-hidden="true" />
              </a>
            ))}
          </div>

          {processing.outputs.length > 1 ? (
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

      <div
        {...getRootProps({
          className: "pdf-dropzone",
          "data-active": isDragActive,
        })}
      >
        <input {...getInputProps()} />
        {upload ? (
          <div className="pdf-upload-progress">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <div>
              <strong>{upload.fileName}</strong>
              <div className="pdf-progress-track">
                <span style={{ width: `${upload.progress}%` }} />
              </div>
            </div>
            <span>{upload.progress}%</span>
          </div>
        ) : (
          <>
            <Upload className="size-5" aria-hidden="true" />
            <span>
              Arraste PDFs para inserir páginas ou{" "}
              <strong>selecione arquivos</strong>
            </span>
            <small>Até 20 arquivos, com no máximo 100 MB cada</small>
          </>
        )}
      </div>

      {pages.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={pages.map((page) => page.id)}
            strategy={rectSortingStrategy}
          >
            <section
              className="pdf-page-grid"
              aria-label="Páginas do documento"
            >
              {pages.map((page, index) => (
                <SortablePage
                  key={page.id}
                  page={page}
                  document={documents.current.get(page.artifactId)}
                  index={index}
                  selected={selectedIds.has(page.id)}
                  menuOpen={menuPageId === page.id}
                  locked={processingLocked}
                  onSelect={handleSelect}
                  onMenu={setMenuPageId}
                  onRotate={(id) => rotate(new Set([id]))}
                  onDuplicate={(id) => duplicate(new Set([id]))}
                  onDelete={(id) => remove(new Set([id]))}
                />
              ))}
            </section>
          </SortableContext>

          <DragOverlay>
            {activePage ? (
              <div className="pdf-page-drag-overlay">
                <GripVertical className="size-5" aria-hidden="true" />
                {activePage.fileName} · página {activePage.sourcePage}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <section className="pdf-empty-workspace">
          <div>
            <Upload className="size-8" aria-hidden="true" />
          </div>
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyDescription}</p>
        </section>
      )}
    </div>
  );
}
