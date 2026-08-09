import { createReadStream } from "node:fs";
import path from "node:path";
import { Unzip } from "fflate";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");

export function stripFileNameControlCharacters(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && code > 0x1f && code !== 0x7f;
    })
    .join("");
}

export async function validateGeneratedPdf(contents: Uint8Array) {
  if (
    contents.byteLength < PDF_SIGNATURE.length ||
    !Buffer.from(contents.subarray(0, PDF_SIGNATURE.length)).equals(
      PDF_SIGNATURE,
    )
  ) {
    throw new PdfStorageError(
      "INVALID_PDF",
      "O processador não gerou um arquivo PDF válido.",
    );
  }

  try {
    const document = await PDFDocument.load(contents, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    if (document.getPageCount() < 1) {
      throw new Error("PDF sem páginas");
    }
  } catch {
    throw new PdfStorageError(
      "INVALID_PDF",
      "O resultado não pôde ser validado como PDF completo. Nenhum arquivo parcial foi disponibilizado.",
    );
  }
}

export async function validateGeneratedImage(
  contents: Uint8Array,
  extension: "jpg" | "png",
) {
  try {
    const metadata = await sharp(contents, {
      failOn: "error",
      limitInputPixels: 100_000_000,
    }).metadata();
    const expectedFormat = extension === "jpg" ? "jpeg" : "png";
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new Error("Imagem sem dimensões ou em formato inesperado");
    }
  } catch {
    throw new PdfStorageError(
      "INVALID_IMAGE",
      "O resultado da conversão não pôde ser validado. Nenhuma imagem parcial foi disponibilizada.",
    );
  }
}

export class PdfStorageError extends Error {
  constructor(
    public readonly code:
      | "EMPTY_FILE"
      | "INVALID_PDF"
      | "INVALID_IMAGE"
      | "INVALID_DOCUMENT"
      | "FILE_TOO_LARGE"
      | "INCOMPLETE_UPLOAD"
      | "INVALID_FILE_NAME"
      | "UPLOAD_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "PdfStorageError";
  }
}

function getPdfStorageRoot() {
  const configuredRoot = process.env.PDF_STORAGE_DIR;

  if (configuredRoot) {
    if (!path.isAbsolute(configuredRoot)) {
      throw new PdfStorageError(
        "UPLOAD_FAILED",
        "PDF_STORAGE_DIR precisa usar um caminho absoluto.",
      );
    }
    return path.normalize(configuredRoot);
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "storage",
    "pdf-jobs",
  );
}

export function resolveInsideStorage(...segments: string[]) {
  const root = getPdfStorageRoot();
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PdfStorageError(
      "UPLOAD_FAILED",
      "Não foi possível preparar o armazenamento do arquivo.",
    );
  }

  return target;
}

export function resolvePdfStorageKey(storageKey: string) {
  return resolveInsideStorage(storageKey);
}

export function sanitizePdfFileName(value: string | null) {
  let decoded = "";

  try {
    decoded = decodeURIComponent(value ?? "");
  } catch {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "O nome do arquivo enviado é inválido.",
    );
  }

  const fileName = stripFileNameControlCharacters(path.basename(decoded)).trim();

  if (!fileName || fileName.length > 180) {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "Use um nome de arquivo com até 180 caracteres.",
    );
  }

  return fileName.toLowerCase().endsWith(".pdf")
    ? fileName
    : `${fileName}.pdf`;
}

export const IMAGE_FORMATS = {
  "image/jpeg": {
    extension: "jpg",
    valid(signature: Buffer) {
      return (
        signature.length >= 3 &&
        signature[0] === 0xff &&
        signature[1] === 0xd8 &&
        signature[2] === 0xff
      );
    },
  },
  "image/png": {
    extension: "png",
    valid(signature: Buffer) {
      return signature
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    },
  },
  "image/webp": {
    extension: "webp",
    valid(signature: Buffer) {
      return (
        signature.subarray(0, 4).toString("ascii") === "RIFF" &&
        signature.subarray(8, 12).toString("ascii") === "WEBP"
      );
    },
  },
} as const;

export const OFFICE_FORMATS = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: "docx",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extension: "xlsx",
  },
} as const;

export async function validateOfficeArchive(
  filePath: string,
  extension: "docx" | "xlsx",
) {
  const names = new Set<string>();
  let declaredBytes = 0;
  let entries = 0;
  const unzip = new Unzip((file) => {
    entries += 1;
    declaredBytes += file.originalSize ?? 0;
    names.add(file.name.replaceAll("\\", "/"));
  });

  try {
    for await (const chunk of createReadStream(filePath)) {
      unzip.push(new Uint8Array(chunk as Buffer), false);
      if (entries > 20_000 || declaredBytes > 2 * 1024 * 1024 * 1024) {
        throw new PdfStorageError(
          "INVALID_DOCUMENT",
          "O documento contém uma estrutura interna fora dos limites.",
        );
      }
    }
    unzip.push(new Uint8Array(), true);
  } catch (error) {
    if (error instanceof PdfStorageError) throw error;
    throw new PdfStorageError(
      "INVALID_DOCUMENT",
      "O documento Office possui uma estrutura interna inválida.",
    );
  }

  const requiredPart =
    extension === "docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!names.has("[Content_Types].xml") || !names.has(requiredPart)) {
    throw new PdfStorageError(
      "INVALID_DOCUMENT",
      `O arquivo não contém uma estrutura ${extension.toUpperCase()} reconhecida.`,
    );
  }
}

export function sanitizeImageFileName(
  value: string | null,
  mimeType: keyof typeof IMAGE_FORMATS,
) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value ?? "");
  } catch {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "O nome da imagem enviada é inválido.",
    );
  }

  const fileName = stripFileNameControlCharacters(path.basename(decoded)).trim();
  if (!fileName || fileName.length > 180) {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "Use um nome de arquivo com até 180 caracteres.",
    );
  }

  const baseName =
    fileName.replace(/\.(?:jpe?g|png|webp)$/i, "").slice(0, 170) ||
    "imagem";
  return `${baseName}.${IMAGE_FORMATS[mimeType].extension}`;
}

export function sanitizeOfficeFileName(
  value: string | null,
  mimeType: keyof typeof OFFICE_FORMATS,
) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value ?? "");
  } catch {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "O nome do documento enviado é inválido.",
    );
  }

  const fileName = stripFileNameControlCharacters(path.basename(decoded)).trim();
  if (!fileName || fileName.length > 180) {
    throw new PdfStorageError(
      "INVALID_FILE_NAME",
      "Use um nome de arquivo com até 180 caracteres.",
    );
  }

  const extension = OFFICE_FORMATS[mimeType].extension;
  const baseName =
    fileName.replace(/\.(?:docx|xlsx)$/i, "").slice(0, 170) || "documento";
  return `${baseName}.${extension}`;
}

