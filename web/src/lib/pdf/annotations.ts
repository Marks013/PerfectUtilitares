import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PdfAnnotation, PdfManifest } from "@/lib/pdf/schema";

function parseColor(color: string) {
  return rgb(
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  );
}

function topToPdfY(pageHeight: number, normalizedY: number) {
  return pageHeight * (1 - normalizedY);
}

export async function applyPdfAnnotations({
  annotations,
  manifest,
  pdfBytes,
}: {
  annotations: PdfAnnotation[];
  manifest: PdfManifest;
  pdfBytes: Uint8Array;
}) {
  if (!annotations.length) return pdfBytes;

  const document = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pages = document.getPages();
  const needsFont = annotations.some(
    (annotation) => annotation.type === "TEXT",
  );
  let annotationFont;
  if (needsFont) {
    try {
      const fontPath =
        process.env.PDF_FONT_PATH ?? "/usr/share/fonts/dejavu/DejaVuSans.ttf";
      document.registerFontkit(fontkit);
      annotationFont = await document.embedFont(await readFile(fontPath), {
        subset: true,
      });
    } catch {
      annotationFont = await document.embedFont(StandardFonts.Helvetica);
    }
  }
  const outputIndexByPageId = new Map(
    manifest.pages.map((instruction, index) => [instruction.id, index]),
  );

  for (const annotation of annotations) {
    const outputIndex = outputIndexByPageId.get(annotation.pageId);
    if (outputIndex === undefined) continue;

    const page = pages[outputIndex];
    if (!page) continue;

    const { height, width } = page.getSize();
    const color = parseColor(annotation.color);

    if (annotation.type === "TEXT") {
      page.drawText(annotation.text, {
        color,
        font: annotationFont,
        maxWidth: Math.max(1, width * (1 - annotation.x)),
        size: annotation.fontSize,
        x: annotation.x * width,
        y: topToPdfY(height, annotation.y) - annotation.fontSize,
      });
      continue;
    }

    if (annotation.type === "HIGHLIGHT") {
      page.drawRectangle({
        color,
        height: annotation.height * height,
        opacity: annotation.opacity,
        width: annotation.width * width,
        x: annotation.x * width,
        y: topToPdfY(height, annotation.y + annotation.height),
      });
      continue;
    }

    if (annotation.type === "RECTANGLE") {
      page.drawRectangle({
        borderColor: color,
        borderOpacity: annotation.opacity,
        borderWidth: 2,
        height: annotation.height * height,
        width: annotation.width * width,
        x: annotation.x * width,
        y: topToPdfY(height, annotation.y + annotation.height),
      });
      continue;
    }

    if (annotation.type !== "DRAW") continue;

    for (let index = 1; index < annotation.points.length; index += 1) {
      const start = annotation.points[index - 1]!;
      const end = annotation.points[index]!;
      page.drawLine({
        color,
        end: {
          x: end.x * width,
          y: topToPdfY(height, end.y),
        },
        opacity: annotation.opacity,
        start: {
          x: start.x * width,
          y: topToPdfY(height, start.y),
        },
        thickness: annotation.width,
      });
    }
  }

  return document.save({
    addDefaultPage: false,
    objectsPerTick: 50,
    useObjectStreams: true,
  });
}
