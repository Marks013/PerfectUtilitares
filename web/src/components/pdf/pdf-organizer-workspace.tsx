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
} from "@dnd-kit/sortable";
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
import { isAbortError, pollPdfJob } from "@/components/pdf/pdf-job-polling";
import { PdfVisualCropEditor } from "@/components/pdf/pdf-visual-crop-editor";
import { cropWorkspacePages } from "./pdf-organizer-crop";
import { PdfWorkspaceResetBoundary } from "./pdf-workspace-reset-boundary";
import {
  combinePageRotation,
  sourceMarginsToDisplay,
} from "@/lib/pdf/geometry";
import {
  type WorkspacePage,
  type UploadState,
  type ApiError,
  type PdfOutput,
  type PdfJobResult,
  type RecoverableJob,
  type ProcessingState,
  type StructuralPdfOperation,
  WORKSPACE_COPY,
  readApiError,
  triggerDownload,
  createOrganizerJob,
  uploadPdf,
  loadPdfDocument,
  nextRotation,
  SortablePage
} from "./pdf-organizer-workspace-model";
export * from "./pdf-organizer-workspace-model";
import { PdfOrganizerWorkspaceView } from "./pdf-organizer-workspace-view";

export function usePdfOrganizerWorkspaceController({
  operation = "ORGANIZE",
}: {
  operation?: StructuralPdfOperation;
}) {
  const copy = WORKSPACE_COPY[operation];
  const documents = useRef(new Map<string, PDFDocumentProxy>());
  const recoveryStarted = useRef(false);
  const processingAbort = useRef<AbortController | null>(null);
  const lifetime = useRef(new AbortController());
  const manifestSave = useRef<Promise<void>>(Promise.resolve());
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
  const [cropPending, setCropPending] = useState(false);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const [jpgOptions, setJpgOptions] = useState({ dpi: 200, quality: 90 });
  const processingLocked =
    applyingCrop ||
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

  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => {
      lifetime.current.abort();
      processingAbort.current?.abort();
      for (const document of documents.current.values()) void document.loadingTask.destroy();
      documents.current.clear();
    };
  }, []);

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
    const signal = lifetime.current.signal;

    async function recoverDraft() {
      setUpload({ fileName: "Reabrindo organização", progress: 0 });
      setError(null);
      try {
        const response = await fetch(`/api/pdf/jobs/${recoveredJobId}`, {
          cache: "no-store",
          signal,
        });
        const body = (await response.json()) as
          { job: RecoverableJob } | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível reabrir esta organização."),
          );
        }
        if (body.job.status !== "DRAFT" || body.job.operation !== operation) {
          throw new Error(
            "Esta organização expirou. Adicione os PDFs novamente para continuar.",
          );
        }

        const options =
          body.job.options && typeof body.job.options === "object"
            ? (body.job.options as {
                jpg?: { dpi: number; quality: number };
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
          const document = await loadPdfDocument(body.job.id, input.id, signal);
          if (signal.aborted) {
            void document.loadingTask.destroy();
            return;
          }
          documents.current.set(input.id, document);
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
        if (signal.aborted) return;
        if (options.jpg && Number.isInteger(options.jpg.dpi) && options.jpg.dpi >= 96 && options.jpg.dpi <= 300
          && Number.isInteger(options.jpg.quality) && options.jpg.quality >= 40 && options.jpg.quality <= 100) {
          setJpgOptions(options.jpg);
        }
        setJobId(body.job.id);
        setPages(recoveredPages);
        setSelectedIds(new Set());
        setSaveState("saved");
        setProcessing({ outputs: [], progress: 0, status: "IDLE" });
      } catch (caught) {
        if (signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível reabrir esta organização.",
        );
      } finally {
        if (!signal.aborted) setUpload(null);
      }
    }

    void recoverDraft();
    return () => { recoveryStarted.current = false; };
  }, [operation]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      const signal = lifetime.current.signal;
      setError(null);
      setUpload({ fileName: acceptedFiles[0].name, progress: 0 });

      try {
        let currentJobId = jobId;
        if (!currentJobId) {
          currentJobId = await createOrganizerJob(operation, signal);
          if (signal.aborted) return;
          setJobId(currentJobId);
        }

        for (const file of acceptedFiles) {
          setUpload({ fileName: file.name, progress: 0 });
          const artifactId = await uploadPdf(currentJobId, file, (progress) =>
            setUpload({ fileName: file.name, progress }), signal);
          if (signal.aborted) return;
          const document = await loadPdfDocument(currentJobId, artifactId, signal);
          if (signal.aborted) {
            void document.loadingTask.destroy();
            return;
          }
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
        if (signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível abrir os arquivos selecionados.",
        );
      } finally {
        if (!signal.aborted) setUpload(null);
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

  const persistManifest = useCallback(async (pagesToSave = pages) => {
    // Keep the final snapshot after any autosave already in flight.
    const save = manifestSave.current.catch(() => undefined).then(async () => {
    if (!jobId || !pagesToSave.length) {
      throw new Error("Adicione ao menos uma página ao documento.");
    }
    setSaveState("saving");
    const response = await fetch(`/api/pdf/jobs/${jobId}`, {
      method: "PATCH",
      signal: lifetime.current.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(operation === "PDF_TO_JPG" ? { jpg: jpgOptions } : {}),
        manifest: {
          version: 1,
          pages: pagesToSave.map((page) => ({
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
    });
    manifestSave.current = save;
    return save;
  }, [jobId, pages, operation, jpgOptions]);

  useEffect(() => {
    if (!jobId || !pages.length || processingLocked) return;

    const timer = window.setTimeout(() => {
      if (processingAbort.current || lifetime.current.signal.aborted) return;
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
      setCropPending(false);
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
    setApplyingCrop(true);
    try {
      const cropped = await cropWorkspacePages(pages, ids, cropMargins, documents.current);
      if (lifetime.current.signal.aborted) return;
      commitPages(() => cropped);
      setCropPending(false);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível aplicar o recorte. Tente novamente.",
      );
    } finally {
      setApplyingCrop(false);
    }
  }

  function undo() {
    setCropPending(false);
    const previous = past.current.at(-1);
    if (!previous) return;
    setCropMargins(previous[0]?.cropMargins ?? { bottom: 0, left: 0, right: 0, top: 0 });
    setPages((current) => {
      future.current = [current, ...future.current.slice(0, 39)];
      return previous;
    });
    past.current = past.current.slice(0, -1);
    setSelectedIds(new Set());
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    setCropPending(false);
    const next = future.current[0];
    if (!next) return;
    setCropMargins(next[0]?.cropMargins ?? { bottom: 0, left: 0, right: 0, top: 0 });
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
      const finalPages = operation === "CROP" && cropPending
        ? await cropWorkspacePages(pages,
            selectedIds.size ? selectedIds : new Set([pages[0].id]),
            cropMargins, documents.current)
        : pages;
      if (operation === "CROP" && !finalPages.some((page) => page.crop)) {
        throw new Error("Ajuste a área de recorte antes de salvar o PDF.");
      }
      if (controller.signal.aborted || lifetime.current.signal.aborted) return;
      if (finalPages !== pages) {
        commitPages(() => finalPages);
        setCropPending(false);
      }
      await persistManifest(finalPages);
      if (controller.signal.aborted) return;
      const queueResponse = await fetch(`/api/pdf/jobs/${jobId}/queue`, {
        method: "POST",
        signal: controller.signal,
      });
      const queueBody = (await queueResponse.json()) as
        { job: PdfJobResult } | ApiError;
      if (controller.signal.aborted) return;

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
        throw new Error(
          "Não conseguimos gerar o arquivo. Confira se os PDFs abrem normalmente e tente novamente.",
        );
      }

      const downloadUrl =
        outputs.length > 1
          ? `/api/pdf/jobs/${jobId}/outputs/zip`
          : `/api/pdf/jobs/${jobId}/outputs/${firstOutput.id}`;
      triggerDownload(downloadUrl);
    } catch (caught) {
      if (isAbortError(caught) || controller.signal.aborted) return;
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

  function updateCropMargins(margins: typeof cropMargins) {
    setCropMargins(margins);
    setCropPending(true);
  }

    return { jpgOptions, setJpgOptions, Archive, ArrowLeft, Check, Copy, Crop, DndContext, Download, DragOverlay, GripVertical, Link, Loader2, PdfVisualCropEditor, Redo2, RotateCw, Save, SortableContext, SortablePage, Trash2, Undo2, Upload, X, activePage, applyCrop, closestCenter, copy, cropMargins, cropPending, cropPreviewPage, documents, duplicate, error, finalizePdf, future, getInputProps, getRootProps, handleDragEnd, handleDragStart, handleSelect, historyVersion, isDragActive, jobId, menuPageId, operation, pages, past, processing, processingLocked, rectSortingStrategy, redo, remove, rotate, saveState, selected, selectedIds, sensors, setActiveId, setCropMargins: updateCropMargins, setError, setMenuPageId, setSelectedIds, undo, upload };
}

function OrganizerContent(props: Parameters<typeof usePdfOrganizerWorkspaceController>[0]) {
  return <PdfOrganizerWorkspaceView model={usePdfOrganizerWorkspaceController(props)} />;
}

export function PdfOrganizerWorkspace(props: Parameters<typeof usePdfOrganizerWorkspaceController>[0]) {
  return <PdfWorkspaceResetBoundary><OrganizerContent {...props} /></PdfWorkspaceResetBoundary>;
}
