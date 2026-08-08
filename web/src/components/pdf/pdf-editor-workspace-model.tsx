"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Highlighter,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  configurePdfJsClient,
  pdfJsClientUrlOptions,
} from "@/lib/pdf/pdfjs-client";
import { combinePageRotation } from "@/lib/pdf/geometry";
import type { PdfAnnotation, PdfManifest } from "@/lib/pdf/schema";
export type EditorOperation = "EDIT" | "ANNOTATE";
export type EditorTool = "SELECT" | "TEXT" | "HIGHLIGHT" | "RECTANGLE" | "DRAW";
export type Point = { x: number; y: number };

export type EditorPage = PdfManifest["pages"][number];
export type ApiError = { error?: { message?: string } };
export type OutputArtifact = {
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
  artifacts: Array<OutputArtifact | { id: string; kind: string }>;
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

export const TOOL_OPTIONS: Array<{
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

export function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

export function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function createJob(operation: EditorOperation) {
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

export async function loadPdfDocument(jobId: string, artifactId: string) {
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

export function EditorCanvas({
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
