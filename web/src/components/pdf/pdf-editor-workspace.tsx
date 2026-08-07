"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  Check,
  Download,
  Eraser,
  Highlighter,
  Loader2,
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useDropzone } from "react-dropzone";
import { PdfPageThumbnail } from "@/components/pdf/pdf-page-thumbnail";
import { isAbortError, pollPdfJob } from "@/components/pdf/pdf-job-polling";
import {
  configurePdfJsClient,
  pdfJsClientUrlOptions,
} from "@/lib/pdf/pdfjs-client";
import { combinePageRotation } from "@/lib/pdf/geometry";
import type { PdfAnnotation, PdfManifest } from "@/lib/pdf/schema";

type EditorOperation = "EDIT" | "ANNOTATE";
type EditorTool = "SELECT" | "TEXT" | "HIGHLIGHT" | "RECTANGLE" | "DRAW";
type Point = { x: number; y: number };

type EditorPage = PdfManifest["pages"][number];
type ApiError = { error?: { message?: string } };
type OutputArtifact = {
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
  artifacts: Array<OutputArtifact | { id: string; kind: string }>;
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

const TOOL_OPTIONS: Array<{
  icon: typeof MousePointer2;
  label: string;
  value: EditorTool;
}> = [
  { icon: MousePointer2, label: "Selecionar", value: "SELECT" },
  { icon: Type, label: "Texto", value: "TEXT" },
  { icon: Highlighter, label: "Destacar", value: "HIGHLIGHT" },
  { icon: Square, label: "Retângulo", value: "RECTANGLE" },
  { icon: Pencil, label: "Desenhar", value: "DRAW" },
];

function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function createJob(operation: EditorOperation) {
  const response = await fetch("/api/pdf/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation }),
  });
  const body = (await response.json()) as { job: { id: string } } | ApiError;
  if (!response.ok || !("job" in body)) {
    throw new Error(readApiError(body, "Não foi possível iniciar a edição."));
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
      let body: { artifactId?: unknown; error?: { message?: string } } | null;
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        body = null;
      }
      if (
        request.status >= 200 &&
        request.status < 300 &&
        typeof body?.artifactId === "string"
      ) {
        resolve(body.artifactId);
      } else {
        reject(
          new Error(
            readApiError(
              body,
              "Não foi possível enviar o arquivo selecionado.",
            ),
          ),
        );
      }
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

function clampPoint(point: Point): Point {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
}

function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return clampPoint({
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  });
}

function EditorCanvas({
  annotations,
  color,
  document,
  fontSize,
  lineWidth,
  onAdd,
  opacity,
  page,
  text,
  tool,
}: {
  annotations: PdfAnnotation[];
  color: string;
  document: PDFDocumentProxy;
  fontSize: number;
  lineWidth: number;
  onAdd: (annotation: PdfAnnotation) => void;
  opacity: number;
  page: EditorPage;
  text: string;
  tool: EditorTool;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<Point | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const [aspectRatio, setAspectRatio] = useState(Math.SQRT1_2);
  const [areaPreview, setAreaPreview] = useState<{
    height: number;
    width: number;
    x: number;
    y: number;
  } | null>(null);
  const [drawPreview, setDrawPreview] = useState<Point[]>([]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;

    async function render() {
      const sourcePage = await document.getPage(page.sourcePage);
      if (cancelled || !canvasRef.current) return;

      const displayRotation = combinePageRotation(
        sourcePage.rotate,
        page.rotation,
      );
      const base = sourcePage.getViewport({
        scale: 1,
        rotation: displayRotation,
      });
      const scale = Math.min(2, 1_400 / base.width);
      const viewport = sourcePage.getViewport({
        scale,
        rotation: displayRotation,
      });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      setAspectRatio(viewport.width / viewport.height);
      renderTask = sourcePage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform:
          pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await renderTask.promise;
    }

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, page.rotation, page.sourcePage]);

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!startRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (tool === "DRAW") {
      if (pointsRef.current.length >= 2) {
        onAdd({
          id: crypto.randomUUID(),
          pageId: page.id,
          type: "DRAW",
          color,
          opacity,
          points: pointsRef.current,
          width: lineWidth,
        });
      }
      pointsRef.current = [];
      setDrawPreview([]);
    } else if (
      areaPreview &&
      areaPreview.width > 0.005 &&
      areaPreview.height > 0.005
    ) {
      onAdd({
        id: crypto.randomUUID(),
        pageId: page.id,
        type: tool === "HIGHLIGHT" ? "HIGHLIGHT" : "RECTANGLE",
        color,
        opacity,
        ...areaPreview,
      });
      setAreaPreview(null);
    }
    startRef.current = null;
  }

  return (
    <div className="pdf-editor-canvas" data-tool={tool} style={{ aspectRatio }}>
      <canvas ref={canvasRef} aria-label={`Página ${page.sourcePage}`} />
      <div
        className="pdf-editor-canvas__overlay"
        onPointerDown={(event) => {
          if (tool === "SELECT") return;
          const point = pointFromEvent(event);

          if (tool === "TEXT") {
            if (!text.trim()) return;
            onAdd({
              id: crypto.randomUUID(),
              pageId: page.id,
              type: "TEXT",
              color,
              fontSize,
              text: text.trim(),
              ...point,
            });
            return;
          }

          event.currentTarget.setPointerCapture(event.pointerId);
          startRef.current = point;
          if (tool === "DRAW") {
            pointsRef.current = [point];
            setDrawPreview([point]);
          } else {
            setAreaPreview({ ...point, height: 0, width: 0 });
          }
        }}
        onPointerMove={(event) => {
          if (!startRef.current) return;
          const point = pointFromEvent(event);
          if (tool === "DRAW") {
            const previous = pointsRef.current.at(-1);
            if (
              pointsRef.current.length < 2_000 &&
              (!previous ||
                Math.hypot(point.x - previous.x, point.y - previous.y) > 0.003)
            ) {
              pointsRef.current = [...pointsRef.current, point];
              setDrawPreview(pointsRef.current);
            }
            return;
          }

          const start = startRef.current;
          setAreaPreview({
            height: Math.abs(point.y - start.y),
            width: Math.abs(point.x - start.x),
            x: Math.min(start.x, point.x),
            y: Math.min(start.y, point.y),
          });
        }}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {annotations.map((annotation) => {
          if (annotation.type === "TEXT") {
            return (
              <span
                key={annotation.id}
                className="pdf-editor-annotation pdf-editor-annotation--text"
                style={{
                  color: annotation.color,
                  fontSize: `${annotation.fontSize}px`,
                  left: `${annotation.x * 100}%`,
                  top: `${annotation.y * 100}%`,
                }}
              >
                {annotation.text}
              </span>
            );
          }
          if (annotation.type === "DRAW") {
            return (
              <svg
                key={annotation.id}
                aria-hidden="true"
                className="pdf-editor-annotation pdf-editor-annotation--draw"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                <polyline
                  fill="none"
                  opacity={annotation.opacity}
                  points={annotation.points
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  stroke={annotation.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={annotation.width / 600}
                />
              </svg>
            );
          }
          return (
            <span
              key={annotation.id}
              className={`pdf-editor-annotation pdf-editor-annotation--${annotation.type.toLowerCase()}`}
              style={{
                borderColor: annotation.color,
                backgroundColor:
                  annotation.type === "HIGHLIGHT"
                    ? annotation.color
                    : "transparent",
                height: `${annotation.height * 100}%`,
                left: `${annotation.x * 100}%`,
                opacity: annotation.opacity,
                top: `${annotation.y * 100}%`,
                width: `${annotation.width * 100}%`,
              }}
            />
          );
        })}
        {areaPreview ? (
          <span
            className={`pdf-editor-annotation pdf-editor-annotation--preview pdf-editor-annotation--${tool.toLowerCase()}`}
            style={{
              borderColor: color,
              backgroundColor: tool === "HIGHLIGHT" ? color : "transparent",
              height: `${areaPreview.height * 100}%`,
              left: `${areaPreview.x * 100}%`,
              opacity,
              top: `${areaPreview.y * 100}%`,
              width: `${areaPreview.width * 100}%`,
            }}
          />
        ) : null}
        {drawPreview.length ? (
          <svg
            aria-hidden="true"
            className="pdf-editor-annotation pdf-editor-annotation--draw"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              opacity={opacity}
              points={drawPreview
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={lineWidth / 600}
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

export function PdfEditorWorkspace({
  operation,
}: {
  operation: EditorOperation;
}) {
  const recoveryStarted = useRef(false);
  const processingAbort = useRef<AbortController | null>(null);
  const past = useRef<PdfAnnotation[][]>([]);
  const future = useRef<PdfAnnotation[][]>([]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [tool, setTool] = useState<EditorTool>(
    operation === "ANNOTATE" ? "HIGHLIGHT" : "TEXT",
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [processing, setProcessing] = useState<{
    output: OutputArtifact | null;
    progress: number;
    status: PdfJobResult["status"] | "IDLE";
  }>({ output: null, progress: 0, status: "IDLE" });
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState(
    operation === "ANNOTATE" ? "#facc15" : "#2563eb",
  );
  const [text, setText] = useState("Digite o texto");
  const [fontSize, setFontSize] = useState(18);
  const [opacity, setOpacity] = useState(0.35);
  const [lineWidth, setLineWidth] = useState(3);
  const [historyVersion, setHistoryVersion] = useState(0);

  const locked =
    processing.status === "QUEUED" ||
    processing.status === "RUNNING" ||
    processing.status === "SUCCEEDED";
  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const pageAnnotations = useMemo(
    () =>
      selectedPage
        ? annotations.filter(
            (annotation) => annotation.pageId === selectedPage.id,
          )
        : [],
    [annotations, selectedPage],
  );

  useEffect(
    () => () => {
      processingAbort.current?.abort();
    },
    [],
  );

  const commitAnnotations = useCallback(
    (update: (current: PdfAnnotation[]) => PdfAnnotation[]) => {
      setAnnotations((current) => {
        const next = update(current);
        if (next === current) return current;
        past.current = [...past.current.slice(-49), current];
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
      setRecovering(true);
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
          throw new Error("Este rascunho não pode mais ser editado.");
        }
        const input = body.job.artifacts.find(
          (artifact) => artifact.kind === "INPUT",
        );
        if (!input)
          throw new Error("Arquivo original do rascunho não encontrado.");

        const loadedDocument = await loadPdfDocument(body.job.id, input.id);
        const savedOptions =
          body.job.options && typeof body.job.options === "object"
            ? (body.job.options as {
                annotations?: PdfAnnotation[];
                manifest?: PdfManifest;
              })
            : {};
        const savedPages =
          savedOptions.manifest?.pages.filter(
            (page) => page.artifactId === input.id,
          ) ?? [];
        const recoveredPages =
          savedPages.length === loadedDocument.numPages
            ? savedPages
            : Array.from(
                { length: loadedDocument.numPages },
                (_, index): EditorPage => ({
                  id: crypto.randomUUID(),
                  artifactId: input.id,
                  sourcePage: index + 1,
                  rotation: 0,
                }),
              );

        setDocument(loadedDocument);
        setJobId(body.job.id);
        setFileName(input.originalName);
        setPages(recoveredPages);
        setSelectedPageId(recoveredPages[0]?.id ?? null);
        setAnnotations(savedOptions.annotations ?? []);
        setSaveState("saved");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível recuperar o rascunho.",
        );
      } finally {
        setRecovering(false);
      }
    }

    void recoverDraft();
  }, [operation]);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setError(null);
      setUploadProgress(0);

      try {
        const currentJobId = await createJob(operation);
        const artifactId = await uploadPdf(
          currentJobId,
          file,
          setUploadProgress,
        );
        const loadedDocument = await loadPdfDocument(currentJobId, artifactId);
        const importedPages = Array.from(
          { length: loadedDocument.numPages },
          (_, index): EditorPage => ({
            id: crypto.randomUUID(),
            artifactId,
            sourcePage: index + 1,
            rotation: 0,
          }),
        );

        setDocument(loadedDocument);
        setJobId(currentJobId);
        setFileName(file.name);
        setPages(importedPages);
        setSelectedPageId(importedPages[0]?.id ?? null);
        setAnnotations([]);
        past.current = [];
        future.current = [];
        setProcessing({ output: null, progress: 0, status: "IDLE" });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível abrir o arquivo selecionado.",
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [operation],
  );

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: { "application/pdf": [".pdf"] },
      disabled: Boolean(uploadProgress) || locked,
      maxFiles: 1,
      maxSize: 100 * 1024 * 1024,
      multiple: false,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "O PDF pode ter no máximo 100 MB."
        : "Selecione um arquivo PDF válido.",
    );
  }, [fileRejections]);

  const persist = useCallback(async () => {
    if (!jobId || !pages.length) {
      throw new Error("Adicione um PDF antes de salvar.");
    }
    setSaveState("saving");
    const response = await fetch(`/api/pdf/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations,
        manifest: { pages, version: 1 },
      }),
    });
    if (!response.ok) {
      setSaveState("error");
      throw new Error(
        readApiError(
          await response.json(),
          "Não foi possível salvar suas alterações.",
        ),
      );
    }
    setSaveState("saved");
  }, [annotations, jobId, pages]);

  useEffect(() => {
    if (!jobId || !pages.length || locked) return;
    const timer = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [jobId, locked, pages, persist]);

  async function finish() {
    if (!jobId) return;
    processingAbort.current?.abort();
    const controller = new AbortController();
    processingAbort.current = controller;
    setError(null);
    try {
      await persist();
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
        output: null,
        progress: queueBody.job.progress,
        status:
          queueBody.job.status === "SUCCEEDED"
            ? "RUNNING"
            : queueBody.job.status,
      });

      const outputs = await pollPdfJob<
        PdfJobResult["artifacts"][number],
        OutputArtifact
      >({
        jobId,
        signal: controller.signal,
        isOutput: (artifact): artifact is OutputArtifact =>
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
            output: validOutputs[0] ?? null,
            progress: job.progress,
            status: job.status,
          });
        },
      });
      const firstOutput = outputs[0];

      if (!firstOutput) {
        throw new Error("O processamento terminou sem gerar um arquivo.");
      }

      triggerDownload(`/api/pdf/jobs/${jobId}/outputs/${firstOutput.id}`);
    } catch (caught) {
      if (isAbortError(caught)) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir o trabalho.",
      );
      setProcessing((current) => ({ ...current, status: "FAILED" }));
    } finally {
      if (processingAbort.current === controller) {
        processingAbort.current = null;
      }
    }
  }

  function undo() {
    const previous = past.current.at(-1);
    if (!previous) return;
    setAnnotations((current) => {
      future.current = [current, ...future.current].slice(0, 50);
      return previous;
    });
    past.current = past.current.slice(0, -1);
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    const next = future.current[0];
    if (!next) return;
    setAnnotations((current) => {
      past.current = [...past.current.slice(-49), current];
      return next;
    });
    future.current = future.current.slice(1);
    setHistoryVersion((version) => version + 1);
  }

  return (
    <div className="pdf-workspace pdf-editor-workspace">
      <header className="pdf-workspace__header">
        <div>
          <Link href="/pdf" className="pdf-back-link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Ferramentas PDF
          </Link>
          <p className="pdf-eyebrow">
            {operation === "ANNOTATE" ? "Anotar PDF" : "Editar PDF"}
          </p>
          <h1>
            {operation === "ANNOTATE"
              ? "Destaque e registre observações"
              : "Adicione conteúdo ao documento"}
          </h1>
        </div>
        <div className="pdf-editor-header-actions">
          <span className="pdf-save-state" data-state={saveState}>
            {saveState === "saving"
              ? "Salvando"
              : saveState === "saved"
                ? "Alterações salvas"
                : saveState === "error"
                  ? "Falha ao salvar"
                  : "Rascunho automático"}
          </span>
          <button
            type="button"
            className="pdf-icon-button"
            title="Desfazer"
            disabled={!past.current.length || locked}
            onClick={undo}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-icon-button"
            title="Refazer"
            disabled={!future.current.length || locked}
            onClick={redo}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!document || !selectedPage ? (
        <div
          {...getRootProps()}
          className="pdf-dropzone pdf-editor-dropzone"
          data-active={isDragActive}
        >
          <input {...getInputProps()} />
          {recovering ? (
            <>
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
              <strong>Recuperando rascunho</strong>
              <span>Aguarde enquanto o documento é reaberto.</span>
            </>
          ) : uploadProgress !== null ? (
            <>
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
              <strong>Enviando PDF</strong>
              <div className="pdf-progress">
                <span style={{ width: `${uploadProgress}%` }} />
              </div>
              <small>{uploadProgress}%</small>
            </>
          ) : (
            <>
              <Upload className="size-8" aria-hidden="true" />
              <strong>Solte um PDF aqui</strong>
              <span>ou selecione um arquivo de até 100 MB</span>
            </>
          )}
        </div>
      ) : (
        <div className="pdf-editor-layout">
          <aside className="pdf-editor-pages" aria-label="Páginas">
            <div className="pdf-editor-pages__title">
              <strong>{fileName}</strong>
              <span>{pages.length} páginas</span>
            </div>
            <div className="pdf-editor-pages__list">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  type="button"
                  className="pdf-editor-page"
                  data-selected={page.id === selectedPage.id}
                  onClick={() => setSelectedPageId(page.id)}
                >
                  <PdfPageThumbnail
                    document={document}
                    pageNumber={page.sourcePage}
                    rotation={page.rotation}
                  />
                  <span>Página {index + 1}</span>
                  {annotations.some(
                    (annotation) => annotation.pageId === page.id,
                  ) ? (
                    <Check className="size-3.5" aria-label="Página alterada" />
                  ) : null}
                </button>
              ))}
            </div>
          </aside>

          <main className="pdf-editor-stage">
            <div className="pdf-editor-toolbar" role="toolbar">
              {TOOL_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-active={tool === option.value}
                    disabled={locked}
                    title={option.label}
                    onClick={() => setTool(option.value)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="pdf-editor-stage__scroll">
              <EditorCanvas
                annotations={pageAnnotations}
                color={color}
                document={document}
                fontSize={fontSize}
                lineWidth={lineWidth}
                opacity={opacity}
                page={selectedPage}
                text={text}
                tool={tool}
                onAdd={(annotation) =>
                  commitAnnotations((current) => [...current, annotation])
                }
              />
            </div>
          </main>

          <aside className="pdf-editor-properties">
            <section>
              <h2>Propriedades</h2>
              <label>
                Cor
                <span className="pdf-color-control">
                  <input
                    type="color"
                    value={color}
                    disabled={locked}
                    onChange={(event) => setColor(event.target.value)}
                  />
                  <code>{color.toUpperCase()}</code>
                </span>
              </label>
              {tool === "TEXT" ? (
                <>
                  <label>
                    Texto
                    <textarea
                      value={text}
                      maxLength={2_000}
                      disabled={locked}
                      rows={4}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </label>
                  <label>
                    Tamanho <span>{fontSize} pt</span>
                    <input
                      type="range"
                      min="8"
                      max="96"
                      value={fontSize}
                      disabled={locked}
                      onChange={(event) =>
                        setFontSize(Number(event.target.value))
                      }
                    />
                  </label>
                </>
              ) : null}
              {tool === "DRAW" ? (
                <label>
                  Espessura <span>{lineWidth} pt</span>
                  <input
                    type="range"
                    min="1"
                    max="24"
                    value={lineWidth}
                    disabled={locked}
                    onChange={(event) =>
                      setLineWidth(Number(event.target.value))
                    }
                  />
                </label>
              ) : null}
              {tool === "HIGHLIGHT" ||
              tool === "RECTANGLE" ||
              tool === "DRAW" ? (
                <label>
                  Opacidade <span>{Math.round(opacity * 100)}%</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={opacity}
                    disabled={locked}
                    onChange={(event) => setOpacity(Number(event.target.value))}
                  />
                </label>
              ) : null}
            </section>

            <section>
              <div className="pdf-editor-properties__heading">
                <h2>Elementos nesta página</h2>
                <span>{pageAnnotations.length}</span>
              </div>
              <div className="pdf-editor-elements">
                {pageAnnotations.length ? (
                  pageAnnotations.map((annotation, index) => (
                    <div key={annotation.id}>
                      <span
                        className="pdf-editor-elements__swatch"
                        style={{ background: annotation.color }}
                      />
                      <span>
                        {annotation.type === "TEXT"
                          ? annotation.text
                          : annotation.type === "HIGHLIGHT"
                            ? `Destaque ${index + 1}`
                            : annotation.type === "RECTANGLE"
                              ? `Retângulo ${index + 1}`
                              : `Desenho ${index + 1}`}
                      </span>
                      <button
                        type="button"
                        title="Excluir elemento"
                        disabled={locked}
                        onClick={() =>
                          commitAnnotations((current) =>
                            current.filter((item) => item.id !== annotation.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p>Nenhum elemento nesta página.</p>
                )}
              </div>
              {pageAnnotations.length ? (
                <button
                  type="button"
                  className="pdf-editor-clear"
                  disabled={locked}
                  onClick={() =>
                    commitAnnotations((current) =>
                      current.filter(
                        (annotation) => annotation.pageId !== selectedPage.id,
                      ),
                    )
                  }
                >
                  <Eraser className="size-4" aria-hidden="true" />
                  Limpar página
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      )}

      {error ? (
        <div className="pdf-workspace__error" role="alert">
          {error}
        </div>
      ) : null}

      {document ? (
        <footer className="pdf-workspace__footer">
          <div>
            {processing.status === "QUEUED" ||
            processing.status === "RUNNING" ? (
              <>
                <span>Processando documento</span>
                <div className="pdf-progress">
                  <span style={{ width: `${processing.progress}%` }} />
                </div>
              </>
            ) : processing.status === "SUCCEEDED" ? (
              <span className="pdf-finished">
                <Check className="size-4" aria-hidden="true" />
                PDF pronto para download
              </span>
            ) : (
              <span>
                {annotations.length} elemento
                {annotations.length === 1 ? "" : "s"} no documento
              </span>
            )}
          </div>
          <div>
            {processing.output && jobId ? (
              <button
                type="button"
                className="pdf-secondary-action"
                onClick={() => {
                  const output = processing.output;
                  if (!output) return;

                  triggerDownload(
                    `/api/pdf/jobs/${jobId}/outputs/${output.id}`,
                  );
                }}
              >
                <Download className="size-4" aria-hidden="true" />
                Baixar novamente
              </button>
            ) : null}
            <button
              type="button"
              className="pdf-primary-action"
              disabled={!jobId || locked || saveState === "saving"}
              onClick={() => void finish()}
            >
              {processing.status === "QUEUED" ||
              processing.status === "RUNNING" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Salvar PDF
            </button>
          </div>
        </footer>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {historyVersion}
      </span>
    </div>
  );
}
