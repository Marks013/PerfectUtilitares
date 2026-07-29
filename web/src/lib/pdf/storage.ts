import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { Unzip } from "fflate";
import {
  MAX_PDF_FILE_BYTES,
  MAX_PDF_IMAGE_BYTES,
} from "@/lib/pdf/constants";

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");

export class PdfStorageError extends Error {
  constructor(
    public readonly code:
      | "EMPTY_FILE"
      | "INVALID_PDF"
      | "INVALID_IMAGE"
      | "INVALID_DOCUMENT"
      | "FILE_TOO_LARGE"
      | "INVALID_FILE_NAME"
      | "UPLOAD_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "PdfStorageError";
  }
}

export function getPdfStorageRoot() {
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

function resolveInsideStorage(...segments: string[]) {
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

  const fileName = path
    .basename(decoded)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

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

export async function writePdfUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
) {
  if (!body) {
    throw new PdfStorageError("EMPTY_FILE", "Selecione um arquivo PDF.");
  }

  const artifactId = randomUUID();
  const relativeKey = `${jobId}/input/${artifactId}.pdf`;
  const finalPath = resolveInsideStorage(relativeKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });

  const handle = await open(temporaryPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      size += value.byteLength;
      if (size > MAX_PDF_FILE_BYTES) {
        throw new PdfStorageError(
          "FILE_TOO_LARGE",
          "O PDF ultrapassa o limite de 100 MB.",
        );
      }

      const chunk = Buffer.from(value);
      if (signature.length < PDF_SIGNATURE.length) {
        signature = Buffer.concat([signature, chunk]).subarray(
          0,
          PDF_SIGNATURE.length,
        );
      }

      hash.update(chunk);
      await handle.write(chunk);
    }

    if (size === 0) {
      throw new PdfStorageError("EMPTY_FILE", "O arquivo enviado está vazio.");
    }

    if (
      signature.length < PDF_SIGNATURE.length ||
      !signature.equals(PDF_SIGNATURE)
    ) {
      throw new PdfStorageError(
        "INVALID_PDF",
        "O arquivo não possui uma estrutura PDF reconhecida.",
      );
    }

    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);

    return {
      artifactId,
      storageKey: relativeKey,
      sizeBytes: BigInt(size),
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const IMAGE_FORMATS = {
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

async function validateOfficeArchive(
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

  const fileName = path
    .basename(decoded)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
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

export async function writeImageUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
  mimeType: keyof typeof IMAGE_FORMATS,
) {
  if (!body) {
    throw new PdfStorageError("EMPTY_FILE", "Selecione uma imagem.");
  }

  const artifactId = randomUUID();
  const extension = IMAGE_FORMATS[mimeType].extension;
  const storageKey = `${jobId}/input/${artifactId}.${extension}`;
  const finalPath = resolveInsideStorage(storageKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > MAX_PDF_IMAGE_BYTES) {
        throw new PdfStorageError(
          "FILE_TOO_LARGE",
          "A imagem ultrapassa o limite de 25 MB.",
        );
      }

      const chunk = Buffer.from(value);
      if (signature.length < 12) {
        signature = Buffer.concat([signature, chunk]).subarray(0, 12);
      }
      hash.update(chunk);
      await handle.write(chunk);
    }

    if (!size) {
      throw new PdfStorageError("EMPTY_FILE", "A imagem enviada está vazia.");
    }
    if (!IMAGE_FORMATS[mimeType].valid(signature)) {
      throw new PdfStorageError(
        "INVALID_IMAGE",
        "O conteúdo não corresponde ao formato da imagem.",
      );
    }

    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    return {
      artifactId,
      sha256: hash.digest("hex"),
      sizeBytes: BigInt(size),
      storageKey,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
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

  const fileName = path
    .basename(decoded)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
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

export async function writeOfficeUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
  mimeType: keyof typeof OFFICE_FORMATS,
) {
  if (!body) {
    throw new PdfStorageError("EMPTY_FILE", "Selecione um documento.");
  }

  const artifactId = randomUUID();
  const extension = OFFICE_FORMATS[mimeType].extension;
  const storageKey = `${jobId}/input/${artifactId}.${extension}`;
  const finalPath = resolveInsideStorage(storageKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      size += value.byteLength;
      if (size > MAX_PDF_FILE_BYTES) {
        throw new PdfStorageError(
          "FILE_TOO_LARGE",
          "O documento ultrapassa o limite de 100 MB.",
        );
      }

      const chunk = Buffer.from(value);
      if (signature.length < 4) {
        signature = Buffer.concat([signature, chunk]).subarray(0, 4);
      }
      hash.update(chunk);
      await handle.write(chunk);
    }

    if (!size) {
      throw new PdfStorageError("EMPTY_FILE", "O documento enviado está vazio.");
    }
    if (
      signature.length < 4 ||
      signature[0] !== 0x50 ||
      signature[1] !== 0x4b ||
      !(
        (signature[2] === 0x03 && signature[3] === 0x04) ||
        (signature[2] === 0x05 && signature[3] === 0x06) ||
        (signature[2] === 0x07 && signature[3] === 0x08)
      )
    ) {
      throw new PdfStorageError(
        "INVALID_DOCUMENT",
        "O conteúdo não corresponde a um documento Office válido.",
      );
    }

    await handle.sync();
    await handle.close();
    await validateOfficeArchive(temporaryPath, extension);
    await rename(temporaryPath, finalPath);
    return {
      artifactId,
      sha256: hash.digest("hex"),
      sizeBytes: BigInt(size),
      storageKey,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function writePdfOutput(
  jobId: string,
  fileName: string,
  contents: Uint8Array,
) {
  const artifactId = randomUUID();
  const safeFileName = sanitizePdfFileName(fileName);
  const relativeKey = `${jobId}/output/${artifactId}.pdf`;
  const finalPath = resolveInsideStorage(relativeKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });

  const handle = await open(temporaryPath, "wx", 0o600);

  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);

    return {
      artifactId,
      originalName: safeFileName,
      storageKey: relativeKey,
      sizeBytes: BigInt(contents.byteLength),
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeBinaryOutput(
  jobId: string,
  fileName: string,
  extension: "jpg" | "png",
  contents: Uint8Array,
) {
  const artifactId = randomUUID();
  const decodedName = path
    .basename(fileName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const baseName =
    decodedName.replace(/\.(?:jpe?g|png)$/i, "").slice(0, 170) || "pagina";
  const originalName = `${baseName}.${extension}`;
  const storageKey = `${jobId}/output/${artifactId}.${extension}`;
  const finalPath = resolveInsideStorage(storageKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);

  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    return {
      artifactId,
      originalName,
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: BigInt(contents.byteLength),
      storageKey,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeOfficeOutput(
  jobId: string,
  fileName: string,
  extension: "docx" | "xlsx",
  contents: Uint8Array,
) {
  const artifactId = randomUUID();
  const decodedName = path
    .basename(fileName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const baseName =
    decodedName.replace(/\.(?:docx|xlsx)$/i, "").slice(0, 170) || "documento";
  const originalName = `${baseName}.${extension}`;
  const storageKey = `${jobId}/output/${artifactId}.${extension}`;
  const finalPath = resolveInsideStorage(storageKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);

  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    return {
      artifactId,
      originalName,
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: BigInt(contents.byteLength),
      storageKey,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function reservePdfOutput(jobId: string, fileName: string) {
  const artifactId = randomUUID();
  const originalName = sanitizePdfFileName(fileName);
  const storageKey = `${jobId}/output/${artifactId}.pdf`;
  const finalPath = resolveInsideStorage(storageKey);
  const temporaryPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });

  return {
    artifactId,
    finalPath,
    originalName,
    storageKey,
    temporaryPath,
  };
}

export async function commitPdfOutput(
  reservation: Awaited<ReturnType<typeof reservePdfOutput>>,
) {
  const handle = await open(reservation.temporaryPath, "r");
  const signature = Buffer.alloc(PDF_SIGNATURE.length);

  try {
    const { bytesRead } = await handle.read(
      signature,
      0,
      signature.length,
      0,
    );
    if (
      bytesRead !== PDF_SIGNATURE.length ||
      !signature.equals(PDF_SIGNATURE)
    ) {
      throw new PdfStorageError(
        "INVALID_PDF",
        "O processador não gerou um arquivo PDF válido.",
      );
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(reservation.temporaryPath)) {
    hash.update(chunk);
  }
  const fileStats = await stat(reservation.temporaryPath);
  await rename(reservation.temporaryPath, reservation.finalPath);

  return {
    artifactId: reservation.artifactId,
    originalName: reservation.originalName,
    sha256: hash.digest("hex"),
    sizeBytes: BigInt(fileStats.size),
    storageKey: reservation.storageKey,
  };
}

export async function discardPdfOutput(
  reservation: Awaited<ReturnType<typeof reservePdfOutput>>,
) {
  await rm(reservation.temporaryPath, { force: true });
  await rm(reservation.finalPath, { force: true });
}

export function createPdfStorageReadStream(storageKey: string) {
  return createReadStream(resolveInsideStorage(storageKey));
}

export async function readPdfStorageFile(storageKey: string) {
  return readFile(resolveInsideStorage(storageKey));
}

export async function removePdfJobFiles(jobId: string) {
  const jobPath = resolveInsideStorage(jobId);
  await rm(jobPath, { force: true, recursive: true });
}

export async function removePdfStorageKey(storageKey: string) {
  const filePath = resolveInsideStorage(storageKey);
  await rm(filePath, { force: true });
}
