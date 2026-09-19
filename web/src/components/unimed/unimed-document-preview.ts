export function unimedDocumentFileName(
  kind: "RN561" | "INACTIVE_TERM",
  holderName: string,
) {
  const title = kind === "RN561" ? "RN-561" : "Termo de Inativo";
  const safeName = holderName
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${title} - ${safeName || "Titular"}.pdf`;
}

export function showUnimedDocumentPreview(
  previewWindow: Window,
  documentBlob: Blob,
  fileName: string,
) {
  const previewUrlApi = (previewWindow as Window & typeof globalThis).URL;
  const documentUrl = previewUrlApi.createObjectURL(documentBlob);
  previewWindow.addEventListener("pagehide", () => {
    previewUrlApi.revokeObjectURL(documentUrl);
  }, { once: true });
  const previewDocument = previewWindow.document;
  previewDocument.title = fileName;
  previewDocument.body.style.cssText =
    "margin:0;height:100vh;display:flex;flex-direction:column;background:#111715;font-family:system-ui,sans-serif";
  const download = previewDocument.createElement("a");
  download.href = documentUrl;
  download.download = fileName;
  download.textContent = `Baixar PDF — ${fileName}`;
  download.style.cssText =
    "display:block;padding:14px 20px;color:#f4f7f5;font-weight:700;overflow-wrap:anywhere";
  const preview = previewDocument.createElement("iframe");
  // O download nativo de URLs blob usa um identificador aleatório como nome.
  preview.src = `${documentUrl}#toolbar=0`;
  preview.title = fileName;
  preview.style.cssText = "display:block;width:100%;flex:1;min-height:0;border:0";
  previewDocument.body.replaceChildren(download, preview);
}
