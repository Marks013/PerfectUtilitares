import path from "node:path";

export function createAttachmentHeader(fileName: string) {
  const safeName = path
    .basename(fileName)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${safeName || "documento.pdf"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function uniqueDownloadName(
  fileName: string,
  usedNames: Set<string>,
) {
  const safeName = path.basename(fileName) || "documento.pdf";
  if (!usedNames.has(safeName)) {
    usedNames.add(safeName);
    return safeName;
  }

  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  let suffix = 2;

  while (usedNames.has(`${baseName}-${suffix}${extension}`)) {
    suffix += 1;
  }

  const uniqueName = `${baseName}-${suffix}${extension}`;
  usedNames.add(uniqueName);
  return uniqueName;
}
