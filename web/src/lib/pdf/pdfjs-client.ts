const PDFJS_PUBLIC_BASE = "/vendor/pdfjs";

type PdfJsClientModule = {
  GlobalWorkerOptions: { workerSrc: string };
};

export function configurePdfJsClient(pdfjs: PdfJsClientModule) {
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_PUBLIC_BASE}/pdf.worker.min.mjs`;
}

export function pdfJsClientDocumentOptions(data: Uint8Array) {
  return {
    cMapPacked: true,
    cMapUrl: `${PDFJS_PUBLIC_BASE}/cmaps/`,
    data,
    standardFontDataUrl: `${PDFJS_PUBLIC_BASE}/standard_fonts/`,
    wasmUrl: `${PDFJS_PUBLIC_BASE}/wasm/`,
  };
}

export function pdfJsClientUrlOptions(url: string) {
  return {
    cMapPacked: true,
    cMapUrl: `${PDFJS_PUBLIC_BASE}/cmaps/`,
    standardFontDataUrl: `${PDFJS_PUBLIC_BASE}/standard_fonts/`,
    url,
    wasmUrl: `${PDFJS_PUBLIC_BASE}/wasm/`,
  };
}
