import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import {
  degrees,
  PDFDocument,
  type PDFFont,
  rgb,
  StandardFonts,
} from "pdf-lib";
import {
  displayPointToPdf,
  displayRectToPdf,
  displaySize,
  normalizeQuarterTurn,
} from "@/lib/pdf/geometry";
import type { PdfAnnotation, PdfManifest } from "@/lib/pdf/schema";

function parseColor(color: string) {
  return rgb(
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  );
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
  let annotationFont: PDFFont | undefined;
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

    const visibleBox = page.getCropBox();
    const rotation = normalizeQuarterTurn(page.getRotation().angle);
    const visibleSize = displaySize(visibleBox, rotation);
    const color = parseColor(annotation.color);

    if (annotation.type === "TEXT") {
      const position = displayPointToPdf(
        {
          x: annotation.x,
          y: Math.min(
            1,
            annotation.y + annotation.fontSize / visibleSize.height,
          ),
        },
        visibleBox,
        rotation,
      );
      page.drawText(annotation.text, {
        color,
        font: annotationFont,
        maxWidth: Math.max(1, visibleSize.width * (1 - annotation.x)),
        rotate: degrees((360 - rotation) % 360),
        size: annotation.fontSize,
        x: position.x,
        y: position.y,
      });
      continue;
    }

    if (annotation.type === "HIGHLIGHT") {
      const rectangle = displayRectToPdf(annotation, visibleBox, rotation);
      page.drawRectangle({
        color,
        height: rectangle.height,
        opacity: annotation.opacity,
        width: rectangle.width,
        x: rectangle.x,
        y: rectangle.y,
      });
      continue;
    }

    if (annotation.type === "RECTANGLE") {
      const rectangle = displayRectToPdf(annotation, visibleBox, rotation);
      page.drawRectangle({
        borderColor: color,
        borderOpacity: annotation.opacity,
        borderWidth: 2,
        height: rectangle.height,
        width: rectangle.width,
        x: rectangle.x,
        y: rectangle.y,
      });
      continue;
    }

    if (annotation.type !== "DRAW") continue;

    let start = annotation.points[0];

    for (const end of annotation.points.slice(1)) {
      if (!start) break;

      page.drawLine({
        color,
        end: displayPointToPdf(end, visibleBox, rotation),
        opacity: annotation.opacity,
        start: displayPointToPdf(start, visibleBox, rotation),
        thickness: annotation.width,
      });

      start = end;
    }
  }

  return document.save({
    addDefaultPage: false,
    objectsPerTick: 50,
    useObjectStreams: true,
  });
}
