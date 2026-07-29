import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { readPdfStorageFile } from "@/lib/pdf/storage";

type ImageInput = {
  originalName: string;
  storageKey: string;
};

const A4 = {
  portrait: [595.28, 841.89] as [number, number],
  landscape: [841.89, 595.28] as [number, number],
};

export async function buildPdfFromImages({
  inputs,
  margin,
  onProgress,
  pageSize,
}: {
  inputs: ImageInput[];
  margin: number;
  pageSize: "A4" | "IMAGE";
  onProgress?: (progress: number) => Promise<void> | void;
}) {
  const document = await PDFDocument.create();

  for (const [index, input] of inputs.entries()) {
    const converted = await sharp(await readPdfStorageFile(input.storageKey))
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 92 })
      .toBuffer({ resolveWithObject: true });
    const image = await document.embedJpg(converted.data);
    const imageWidth = converted.info.width;
    const imageHeight = converted.info.height;

    const dimensions =
      pageSize === "IMAGE"
        ? ([
            Math.max(1, imageWidth * 0.75 + margin * 2),
            Math.max(1, imageHeight * 0.75 + margin * 2),
          ] as [number, number])
        : imageWidth > imageHeight
          ? A4.landscape
          : A4.portrait;
    const page = document.addPage(dimensions);
    const availableWidth = page.getWidth() - margin * 2;
    const availableHeight = page.getHeight() - margin * 2;
    const scale = Math.min(
      availableWidth / imageWidth,
      availableHeight / imageHeight,
    );
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    page.drawImage(image, {
      height,
      width,
      x: (page.getWidth() - width) / 2,
      y: (page.getHeight() - height) / 2,
    });
    await onProgress?.(10 + ((index + 1) / inputs.length) * 78);
  }

  return document.save({
    addDefaultPage: false,
    useObjectStreams: true,
  });
}
