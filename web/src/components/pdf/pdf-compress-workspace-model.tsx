"use client";

import type {
  CompressionColorMode,
  CompressionMethod,
  PdfCompressionAnalysis,
} from "@/lib/pdf/client-compression-analysis";
export type CompressionQuality = "SOURCE" | "SCREEN" | "BALANCED" | "PRINT";

export type CompressionSettings = {
  preset: CompressionQuality | null;
  method: CompressionMethod;
  dpi: number;
  colorMode: CompressionColorMode;
  imageQuality: number;
  monochromeThreshold: number;
};

export type ApiError = {
  error?: { message?: string };
};

export type PdfOutput = {
  id: string;
  kind: "OUTPUT";
  originalName: string;
  sizeBytes: string;
};

export type PdfJob = {
  errorCode?: string | null;
  errorMessage: string | null;
  progress: number;
  status: string;
  artifacts: Array<PdfOutput | { id: string; kind: string }>;
};

export type WorkState = {
  phase: "IDLE" | "UPLOADING" | "QUEUED" | "RUNNING" | "SUCCEEDED";
  progress: number;
  detail: string;
};

export const COMPRESSION_PRESETS: Record<
  Exclude<CompressionQuality, "SOURCE">,
  Omit<CompressionSettings, "preset">
> = {
  SCREEN: {
    method: "RASTER",
    dpi: 96,
    colorMode: "COLOR",
    imageQuality: 55,
    monochromeThreshold: 160,
  },
  BALANCED: {
    method: "AUTO",
    dpi: 150,
    colorMode: "COLOR",
    imageQuality: 72,
    monochromeThreshold: 160,
  },
  PRINT: {
    method: "AUTO",
    dpi: 220,
    colorMode: "COLOR",
    imageQuality: 86,
    monochromeThreshold: 160,
  },
};

export const QUALITY_OPTIONS: Array<{
  value: Exclude<CompressionQuality, "SOURCE">;
  label: string;
  description: string;
}> = [
  {
    value: "SCREEN",
    label: "Compacto",
    description: "96 DPI e recompressão forte",
  },
  {
    value: "BALANCED",
    label: "Equilibrado",
    description: "150 DPI com escolha automática",
  },
  {
    value: "PRINT",
    label: "Impressão",
    description: "220 DPI e maior fidelidade",
  },
];

export const METHOD_OPTIONS: Array<{
  value: CompressionMethod;
  label: string;
  description: string;
}> = [
  {
    value: "AUTO",
    label: "Automática",
    description: "Analisa o PDF e executa apenas a estratégia necessária",
  },
  {
    value: "LOSSLESS",
    label: "Sem perdas",
    description: "Preserva texto, vetores e imagens",
  },
  {
    value: "RASTER",
    label: "Recompressão visual",
    description: "Achata páginas para reduzir de verdade",
  },
];

export const COLOR_OPTIONS: Array<{
  value: CompressionColorMode;
  label: string;
  description: string;
}> = [
  {
    value: "COLOR",
    label: "Colorido",
    description: "24 bits",
  },
  {
    value: "GRAYSCALE",
    label: "Tons de cinza",
    description: "8 bits",
  },
  {
    value: "MONOCHROME",
    label: "Preto e branco",
    description: "1 bit",
  },
];

export function readApiError(value: unknown, fallback: string) {
  return (value as ApiError | null)?.error?.message ?? fallback;
}

export function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function getContentKindLabel(analysis: PdfCompressionAnalysis) {
  if (analysis.contentKind === "VECTOR") return "Texto e vetores";
  if (analysis.contentKind === "MIXED") return "Conteúdo misto";
  if (analysis.contentKind === "SCANNED_OCR") return "Digitalizado + OCR";
  return "Documento digitalizado";
}

export function getColorModeLabel(colorMode: CompressionColorMode) {
  return COLOR_OPTIONS.find((option) => option.value === colorMode)?.label;
}

export function getMedianRounded(values: number[]) {
  if (!values.length) return null;

  const middle = Math.floor(values.length / 2);
  const upper = values[middle];

  if (upper === undefined) return null;
  if (values.length % 2 !== 0) return upper;

  const lower = values[middle - 1];
  if (lower === undefined) return upper;

  return Math.round((lower + upper) / 2);
}

export function getDetectedDpiLabel(analysis: PdfCompressionAnalysis) {
  if (analysis.sourceDpi === null) return "Não se aplica";
  if (
    analysis.minimumDpi !== null &&
    analysis.maximumDpi !== null &&
    analysis.maximumDpi - analysis.minimumDpi >= 20
  ) {
    return `${analysis.minimumDpi}–${analysis.maximumDpi} DPI`;
  }
  return `${analysis.sourceDpi} DPI`;
}

export function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}


export function uploadPdf(
  jobId: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/pdf/jobs/${jobId}/files`);
    request.setRequestHeader("Content-Type", "application/pdf");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      let body: ApiError | null = null;
      try {
        body = JSON.parse(request.responseText) as ApiError;
      } catch {
        body = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(readApiError(body, `Falha ao enviar ${file.name}.`)));
      }
    });
    request.addEventListener("error", () => {
      reject(new Error(`A conexão foi interrompida ao enviar ${file.name}.`));
    });
    request.send(file);
  });
}
