"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

type PdfPageThumbnailProps = {
  document: PDFDocumentProxy | undefined;
  pageNumber: number;
  rotation: 0 | 90 | 180 | 270;
  cropMargins?: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
};

export function PdfPageThumbnail({
  document,
  pageNumber,
  rotation,
  cropMargins,
}: PdfPageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !document || !canvasRef.current) return;

    let cancelled = false;
    let renderTask:
      | { cancel: () => void; promise: Promise<void> }
      | undefined;

    async function render() {
      try {
        const page = await document!.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1, rotation });
        const scale = Math.min(1, 280 / baseViewport.width);
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          setFailed(true);
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, rotation, visible]);

  return (
    <div ref={containerRef} className="pdf-page-thumbnail">
      {!visible || !document ? (
        <span className="pdf-page-thumbnail__loading">Carregando página</span>
      ) : null}
      {failed ? (
        <span className="pdf-page-thumbnail__error">
          Pré-visualização indisponível
        </span>
      ) : (
        <span className="pdf-page-thumbnail__page">
          <canvas ref={canvasRef} aria-label={`Página ${pageNumber}`} />
          {cropMargins ? (
            <span
              className="pdf-page-thumbnail__crop"
              aria-hidden="true"
              style={{
                bottom: `${cropMargins.bottom}%`,
                left: `${cropMargins.left}%`,
                right: `${cropMargins.right}%`,
                top: `${cropMargins.top}%`,
              }}
            />
          ) : null}
        </span>
      )}
    </div>
  );
}
