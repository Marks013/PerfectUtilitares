"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Check,
  Download,
  GripVertical,
  ImagePlus,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

type ImageItem = {
  id: string;
  file: File;
  url: string;
};

type ApiError = { error?: { message?: string } };
type JobOutput = { id: string; kind: "OUTPUT"; originalName: string };
type JobResponse = {
  errorMessage: string | null;
  progress: number;
  status: string;
  artifacts: Array<JobOutput | { id: string; kind: string }>;
};

function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function uploadImage(
  jobId: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/pdf/jobs/${jobId}/images`);
    request.setRequestHeader("Content-Type", file.type);
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
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          new Error(readApiError(body, `Falha ao enviar ${file.name}.`)),
        );
    });
    request.addEventListener("error", () =>
      reject(new Error(`A conexão foi interrompida ao enviar ${file.name}.`)),
    );
    request.send(file);
  });
}

function SortableImage({
  item,
  index,
  locked,
  onRemove,
}: {
  item: ImageItem;
  index: number;
  locked: boolean;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: locked });

  return (
    <article
      ref={setNodeRef}
      className="pdf-image-card"
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="pdf-image-card__toolbar">
        <button
          type="button"
          disabled={locked}
          title="Mover imagem"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <span>Página {index + 1}</span>
        <button
          type="button"
          disabled={locked}
          title={`Remover ${item.file.name}`}
          onClick={() => onRemove(item.id)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {/* biome-ignore lint/performance/noImgElement: preview local criado com URL.createObjectURL */}
      <img src={item.url} alt="" />
      <footer title={item.file.name}>{item.file.name}</footer>
    </article>
  );
}

export function ImagesToPdfWorkspace() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const itemsRef = useRef<ImageItem[]>([]);
  const [pageSize, setPageSize] = useState<"A4" | "IMAGE">("A4");
  const [margin, setMargin] = useState(24);
  const [jobId, setJobId] = useState<string | null>(null);
  const [output, setOutput] = useState<JobOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "IDLE" | "UPLOADING" | "QUEUED" | "RUNNING" | "SUCCEEDED"
  >("IDLE");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("");
  const busy =
    phase === "UPLOADING" || phase === "QUEUED" || phase === "RUNNING";
  const locked = busy || phase === "SUCCEEDED";
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
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.url);
      });
    },
    [],
  );

  const onDrop = (files: File[]) => {
    setError(null);
    setOutput(null);
    setJobId(null);
    setPhase("IDLE");
    setItems((current) => {
      const next = [
        ...current,
        ...files.map((file) => ({
        file,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        })),
      ];
      next.slice(20).forEach((item) => {
        URL.revokeObjectURL(item.url);
      });
      return next.slice(0, 20);
    });
  };

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: {
        "image/jpeg": [".jpg", ".jpeg"],
        "image/png": [".png"],
        "image/webp": [".webp"],
      },
      disabled: locked,
      maxFiles: 20,
      maxSize: 25 * 1024 * 1024,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "Cada imagem pode ter no máximo 25 MB."
        : "Selecione imagens JPG, PNG ou WEBP válidas.",
    );
  }, [fileRejections]);

  function removeItem(id: string) {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((item) => item.id !== id);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (overId === undefined || event.active.id === overId) return;

    setItems((current) => {
      const from = current.findIndex((item) => item.id === event.active.id);
      const to = current.findIndex((item) => item.id === overId);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }

  async function createPdf() {
    if (!items.length || busy) return;
    setError(null);

    try {
      const createResponse = await fetch("/api/pdf/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "JPG_TO_PDF",
          options: { margin, pageSize },
        }),
      });
      const createBody = (await createResponse.json()) as
        | { job: { id: string } }
        | ApiError;
      if (!createResponse.ok || !("job" in createBody)) {
        throw new Error(
          readApiError(createBody, "Não foi possível iniciar o trabalho."),
        );
      }
      const currentJobId = createBody.job.id;
      setJobId(currentJobId);

      for (const [index, item] of items.entries()) {
        setPhase("UPLOADING");
        setDetail(`Enviando ${item.file.name}`);
        await uploadImage(currentJobId, item.file, (fileProgress) =>
          setProgress(
            Math.round(
              ((index + fileProgress / 100) / items.length) * 100,
            ),
          ),
        );
      }

      const queueResponse = await fetch(
        `/api/pdf/jobs/${currentJobId}/queue`,
        { method: "POST" },
      );
      const queueBody = (await queueResponse.json()) as
        | { job: JobResponse }
        | ApiError;
      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível criar o PDF."),
        );
      }
      setPhase("QUEUED");
      setDetail("Aguardando processamento");
      setProgress(0);

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await wait(1_000);
        const response = await fetch(`/api/pdf/jobs/${currentJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as
          | { job: JobResponse }
          | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível acompanhar o trabalho."),
          );
        }
        const result = body.job.artifacts.find(
          (artifact): artifact is JobOutput => artifact.kind === "OUTPUT",
        );
        if (body.job.status === "SUCCEEDED" && result) {
          setOutput(result);
          setPhase("SUCCEEDED");
          setProgress(100);
          setDetail("PDF concluído");
          triggerDownload(
            `/api/pdf/jobs/${currentJobId}/outputs/${result.id}`,
          );
          return;
        }
        if (
          body.job.status === "FAILED" ||
          body.job.status === "CANCELLED" ||
          body.job.status === "EXPIRED"
        ) {
          throw new Error(
            body.job.errorMessage ?? "O PDF não pôde ser criado.",
          );
        }
        setPhase(body.job.status === "RUNNING" ? "RUNNING" : "QUEUED");
        setProgress(body.job.progress);
        setDetail(
          body.job.status === "RUNNING"
            ? "Montando páginas"
            : "Aguardando processamento",
        );
      }
      throw new Error("A criação do PDF demorou além do esperado.");
    } catch (caught) {
      setPhase("IDLE");
      setProgress(0);
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível criar o PDF.",
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
            <p className="pdf-eyebrow">JPG para PDF</p>
            <h1>Monte um documento com suas imagens</h1>
          </div>
        </div>
      </header>

      <section className="pdf-image-settings">
        <div className="pdf-image-settings__group">
          <strong>Tamanho da página</strong>
          <div className="pdf-segmented-control">
            <button
              type="button"
              data-active={pageSize === "A4"}
              disabled={locked}
              onClick={() => setPageSize("A4")}
            >
              A4
            </button>
            <button
              type="button"
              data-active={pageSize === "IMAGE"}
              disabled={locked}
              onClick={() => setPageSize("IMAGE")}
            >
              Ajustar à imagem
            </button>
          </div>
        </div>
        <label>
          <span>
            Margem <b>{margin} pt</b>
          </span>
          <input
            type="range"
            min={0}
            max={72}
            step={4}
            value={margin}
            disabled={locked}
            onChange={(event) => setMargin(Number(event.target.value))}
          />
        </label>
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
          Arraste imagens ou <strong>selecione arquivos</strong>
        </span>
        <small>JPG, PNG ou WEBP · até 20 imagens</small>
      </div>

      {error ? (
        <div className="pdf-alert pdf-alert--danger" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {items.length ? (
        <>
          <div className="pdf-image-actions">
            <span>
              {items.length} página{items.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="pdf-primary-button"
              disabled={locked}
              onClick={() => void createPdf()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="size-4" aria-hidden="true" />
              )}
              {busy ? "Processando" : "Criar PDF"}
            </button>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={rectSortingStrategy}
            >
              <section className="pdf-image-grid">
                {items.map((item, index) => (
                  <SortableImage
                    key={item.id}
                    item={item}
                    index={index}
                    locked={locked}
                    onRemove={removeItem}
                  />
                ))}
              </section>
            </SortableContext>
          </DndContext>
        </>
      ) : null}

      {busy ? (
        <section className="pdf-processing-panel" aria-live="polite">
          <div>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>{detail}</strong>
              <small>Mantenha esta página aberta até concluir.</small>
            </span>
          </div>
          <div className="pdf-progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <b>{progress}%</b>
        </section>
      ) : null}

      {output && jobId ? (
        <section className="pdf-output-panel">
          <div className="pdf-output-panel__heading">
            <span>
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div>
              <strong>PDF pronto</strong>
              <small>{output.originalName}</small>
            </div>
          </div>
          <a
            href={`/api/pdf/jobs/${jobId}/outputs/${output.id}`}
            className="pdf-secondary-button"
          >
            <Download className="size-4" aria-hidden="true" />
            Baixar novamente
          </a>
        </section>
      ) : null}
    </div>
  );
}
