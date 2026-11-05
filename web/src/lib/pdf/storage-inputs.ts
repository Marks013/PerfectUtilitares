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

const UPLOAD_TOTAL_TIMEOUT_MS = 5 * 60_000;
const UPLOAD_CHUNK_TIMEOUT_MS = 30_000;

function uploadTimeoutError() {
  return new PdfStorageError(
    "UPLOAD_FAILED",
    "O envio ficou parado ou demorou demais. Confira a conexão e envie o arquivo novamente.",
  );
}

async function readUploadChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw uploadTimeoutError();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timer = setTimeout(
          () => reject(uploadTimeoutError()),
          Math.min(UPLOAD_CHUNK_TIMEOUT_MS, remaining),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertCompleteUpload(size: number, expectedBytes?: number) {
  if (expectedBytes && size !== expectedBytes) {
    throw new PdfStorageError(
      "INCOMPLETE_UPLOAD",
      "O arquivo recebido esta incompleto. Envie novamente.",
    );
  }
}

function isOfficeSignature(signature: Buffer) {
  return (
    signature.length >= 4 &&
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    (
      (signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08)
    )
  );
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
  const deadline = Date.now() + UPLOAD_TOTAL_TIMEOUT_MS;
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await readUploadChunk(reader, deadline);
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
        if (
          signature.length === PDF_SIGNATURE.length &&
          !signature.equals(PDF_SIGNATURE)
        ) {
          throw new PdfStorageError(
            "INVALID_PDF",
            "O arquivo não possui uma estrutura PDF reconhecida.",
          );
        }
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
    // A source may never settle cancellation; cleanup must not wait for it.
    void reader.cancel().catch(() => undefined);
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
  const deadline = Date.now() + UPLOAD_TOTAL_TIMEOUT_MS;
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await readUploadChunk(reader, deadline);
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
        if (signature.length === 12 && !IMAGE_FORMATS[mimeType].valid(signature)) {
          throw new PdfStorageError(
            "INVALID_IMAGE",
            "O conteúdo não corresponde ao formato da imagem.",
          );
        }
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
    void reader.cancel().catch(() => undefined);
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
  const deadline = Date.now() + UPLOAD_TOTAL_TIMEOUT_MS;
  const hash = createHash("sha256");
  let size = 0;
  let signature = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await readUploadChunk(reader, deadline);
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
        if (signature.length === 4 && !isOfficeSignature(signature)) {
          throw new PdfStorageError(
            "INVALID_DOCUMENT",
            "O conteúdo não corresponde a um documento Office válido.",
          );
        }
      }
      hash.update(chunk);
      await handle.write(chunk);
    }

    if (!size) {
      throw new PdfStorageError("EMPTY_FILE", "O documento enviado está vazio.");
    }
    assertCompleteUpload(size, expectedBytes);
    if (!isOfficeSignature(signature)) {
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
    void reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

