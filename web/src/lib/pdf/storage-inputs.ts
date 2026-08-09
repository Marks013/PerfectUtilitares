import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  MAX_PDF_FILE_BYTES,
  MAX_PDF_IMAGE_BYTES,
} from "@/lib/pdf/constants";
import {
  IMAGE_FORMATS,
  OFFICE_FORMATS,
  PDF_SIGNATURE,
  PdfStorageError,
  resolveInsideStorage,
  validateOfficeArchive,
} from "./storage-core";

function assertCompleteUpload(size: number, expectedBytes?: number) {
  if (expectedBytes && size !== expectedBytes) {
    throw new PdfStorageError(
      "INCOMPLETE_UPLOAD",
      "O arquivo recebido esta incompleto. Envie novamente.",
    );
  }
}

export async function writePdfUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
  expectedBytes?: number,
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

    assertCompleteUpload(size, expectedBytes);

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

export async function writeImageUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
  mimeType: keyof typeof IMAGE_FORMATS,
  expectedBytes?: number,
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
    assertCompleteUpload(size, expectedBytes);
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

export async function writeOfficeUpload(
  body: ReadableStream<Uint8Array> | null,
  jobId: string,
  mimeType: keyof typeof OFFICE_FORMATS,
  expectedBytes?: number,
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
    assertCompleteUpload(size, expectedBytes);
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

