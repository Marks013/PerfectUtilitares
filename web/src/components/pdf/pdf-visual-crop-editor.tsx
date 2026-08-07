"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  combinePageRotation,
  type CropMargins,
  type QuarterTurn,
} from "@/lib/pdf/geometry";

type CropRect = { height: number; width: number; x: number; y: number };
type Handle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const MIN_SIZE = 0.05;
const HANDLES: Exclude<Handle, "move">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
const HANDLE_LABELS: Record<Exclude<Handle, "move">, string> = {
  nw: "Redimensionar canto superior esquerdo",
  n: "Redimensionar borda superior",
  ne: "Redimensionar canto superior direito",
  e: "Redimensionar borda direita",
  se: "Redimensionar canto inferior direito",
  s: "Redimensionar borda inferior",
  sw: "Redimensionar canto inferior esquerdo",
  w: "Redimensionar borda esquerda",
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectFromMargins(margins: CropMargins): CropRect {
  return {
    x: margins.left / 100,
    y: margins.top / 100,
    width: 1 - (margins.left + margins.right) / 100,
    height: 1 - (margins.top + margins.bottom) / 100,
  };
}

function marginsFromRect(rect: CropRect): CropMargins {
  const round = (value: number) =>
    Math.round(clamp(value) * 1_000) / 10;
  return {
    top: round(rect.y),
    right: round(1 - rect.x - rect.width),
    bottom: round(1 - rect.y - rect.height),
    left: round(rect.x),
  };
}

function resizeRect(
  initial: CropRect,
  handle: Handle,
  deltaX: number,
  deltaY: number,
): CropRect {
  if (handle === "move") {
    return {
      ...initial,
      x: clamp(initial.x + deltaX, 0, 1 - initial.width),
      y: clamp(initial.y + deltaY, 0, 1 - initial.height),
    };
  }

  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  if (handle.includes("w")) left = clamp(left + deltaX, 0, right - MIN_SIZE);
  if (handle.includes("e")) right = clamp(right + deltaX, left + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(top + deltaY, 0, bottom - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + deltaY, top + MIN_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function eventPoint(event: PointerEvent<HTMLElement>, element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

export function PdfVisualCropEditor({
  disabled,
  document,
  margins,
  onChange,
  pageNumber,
  rotation,
}: {
  disabled: boolean;
  document: PDFDocumentProxy | undefined;
  margins: CropMargins;
  onChange: (margins: CropMargins) => void;
  pageNumber: number;
  rotation: QuarterTurn;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<{
    handle: Handle | "create";
    initial: CropRect;
    pointerId: number;
    start: { x: number; y: number };
  } | null>(null);
  const draftMarginsRef = useRef(margins);
  const [draftMargins, setDraftMargins] = useState(margins);
  const [aspectRatio, setAspectRatio] = useState(0.707);
  const [renderError, setRenderError] = useState(false);
  const rect = useMemo(
    () => rectFromMargins(draftMargins),
    [draftMargins],
  );

  useEffect(() => {
    draftMarginsRef.current = margins;
    setDraftMargins(margins);
  }, [margins]);

  function updateDraft(next: CropMargins, commit = false) {
    draftMarginsRef.current = next;
    setDraftMargins(next);
    if (commit) onChange(next);
  }

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;

    async function render() {
      try {
        const page = await document!.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const displayRotation = combinePageRotation(page.rotate, rotation);
        const base = page.getViewport({ scale: 1, rotation: displayRotation });
        const scale = Math.min(2, 1_200 / base.width);
        const viewport = page.getViewport({
          scale,
          rotation: displayRotation,
        });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas indisponível");
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        setAspectRatio(viewport.width / viewport.height);
        setRenderError(false);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1
              ? undefined
              : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          setRenderError(true);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, rotation]);

  function beginInteraction(
    event: PointerEvent<HTMLElement>,
    handle: Handle | "create",
  ) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const start = eventPoint(event, stage);
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = {
      handle,
      initial: rect,
      pointerId: event.pointerId,
      start,
    };
    if (handle === "create") {
      updateDraft(
        marginsFromRect({
          x: Math.min(start.x, 1 - MIN_SIZE),
          y: Math.min(start.y, 1 - MIN_SIZE),
          width: MIN_SIZE,
          height: MIN_SIZE,
        }),
      );
    }
  }

  function moveInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const point = eventPoint(event, stage);
    if (active.handle === "create") {
      const width = Math.max(MIN_SIZE, Math.abs(point.x - active.start.x));
      const height = Math.max(MIN_SIZE, Math.abs(point.y - active.start.y));
      const x = Math.min(Math.min(active.start.x, point.x), 1 - width);
      const y = Math.min(Math.min(active.start.y, point.y), 1 - height);
      updateDraft(
        marginsFromRect({
          x,
          y,
          width,
          height,
        }),
      );
      return;
    }
    updateDraft(
      marginsFromRect(
        resizeRect(
          active.initial,
          active.handle,
          point.x - active.start.x,
          point.y - active.start.y,
        ),
      ),
    );
  }

  function endInteraction(event: PointerEvent<HTMLElement>) {
    if (interaction.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interaction.current = null;
    onChange(draftMarginsRef.current);
  }

  function handleKeyboard(
    event: KeyboardEvent<HTMLElement>,
    handle: Handle,
  ) {
    if (disabled || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.05 : 0.01;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    updateDraft(
      marginsFromRect(resizeRect(rect, handle, deltaX, deltaY)),
      true,
    );
  }

  function updateMargin(side: keyof CropMargins, value: number) {
    if (!Number.isFinite(value)) return;
    const next = { ...draftMargins, [side]: clamp(value, 0, 95) };
    if (next.left + next.right > 95 || next.top + next.bottom > 95) return;
    updateDraft(next, true);
  }

  return (
    <div className="pdf-visual-crop">
      <div className="pdf-visual-crop__stage-wrap">
        <div
          ref={stageRef}
          className="pdf-visual-crop__stage"
          style={{ aspectRatio }}
          onPointerDown={(event) => beginInteraction(event, "create")}
          onPointerMove={moveInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
        >
          <canvas ref={canvasRef} aria-label={`Página ${pageNumber} para recorte`} />
          {renderError ? (
            <span className="pdf-visual-crop__error" role="alert">
              Não foi possível exibir esta página. Use os campos numéricos.
            </span>
          ) : null}
          <span
            className="pdf-visual-crop__shade"
            aria-hidden="true"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
          <fieldset
            className="pdf-visual-crop__selection"
            disabled={disabled}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
            onPointerDown={(event) => beginInteraction(event, "move")}
            onPointerMove={moveInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          >
            <legend className="sr-only">Área mantida</legend>
            <button
              type="button"
              className="pdf-visual-crop__move"
              disabled={disabled}
              aria-label="Mover área mantida com as setas"
              onKeyDown={(event) => handleKeyboard(event, "move")}
            />
            {HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                className="pdf-visual-crop__handle"
                data-handle={handle}
                disabled={disabled}
                aria-label={HANDLE_LABELS[handle]}
                onPointerDown={(event) => beginInteraction(event, handle)}
                onPointerMove={moveInteraction}
                onPointerUp={endInteraction}
                onPointerCancel={endInteraction}
                onKeyDown={(event) => handleKeyboard(event, handle)}
              />
            ))}
          </fieldset>
        </div>
        <small>Arraste sobre a página para criar a área; mova ou use as alças para ajustar.</small>
      </div>

      <div className="pdf-visual-crop__fields">
        {(
          [
            ["top", "Superior"],
            ["right", "Direita"],
            ["bottom", "Inferior"],
            ["left", "Esquerda"],
          ] as const
        ).map(([side, label]) => (
          <label key={side}>
            <span>{label}</span>
            <span>
              <input
                type="number"
                min={0}
                max={95}
                step={0.1}
                value={draftMargins[side]}
                disabled={disabled}
                onChange={(event) => updateMargin(side, Number(event.target.value))}
              />
              %
            </span>
          </label>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            updateDraft({ top: 0, right: 0, bottom: 0, left: 0 }, true)
          }
        >
          Redefinir área
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        Área mantida: {Math.round(rect.width * 100)}% por {Math.round(rect.height * 100)}%.
      </span>
    </div>
  );
}
