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
import {
  PDF_SIGNATURE,
  PdfStorageError,
  resolveInsideStorage,
  sanitizePdfFileName,
  stripFileNameControlCharacters,
  validateGeneratedImage,
  validateGeneratedPdf,
  validateOfficeArchive,
} from "./storage-core";

export async function writePdfOutput(
  jobId: string,
  fileName: string,
  contents: Uint8Array,
) {
  await validateGeneratedPdf(contents);
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
  await validateGeneratedImage(contents, extension);
  const artifactId = randomUUID();
  const decodedName = stripFileNameControlCharacters(path.basename(fileName)).trim();
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
  const decodedName = stripFileNameControlCharacters(path.basename(fileName)).trim();
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
    await validateOfficeArchive(temporaryPath, extension);
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
  const handle = await open(reservation.temporaryPath, "r+");
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
