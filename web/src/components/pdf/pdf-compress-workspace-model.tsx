"use client";
// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_REVALIDATION_V1_2
// PERFECT_PDF_ADAPTIVE_V4_2

import type {
  CompressionColorMode,
  CompressionMethod,
  PdfCompressionAnalysis,
} from "@/lib/pdf/client-compression-analysis";
import { PDF_COMPRESSION_PRESETS } from "@/lib/pdf/compression-policy";

export type CompressionQuality = "SOURCE" | "SCREEN" | "BALANCED" | "PRINT";
export type CompressionColorPolicy = "KEEP_DETECTED" | CompressionColorMode;

export type CompressionOverrides = {
  method: boolean;
  dpi: boolean;
  colorMode: boolean;
  imageQuality: boolean;
  monochromeThreshold: boolean;
};

export const NO_OVERRIDES: CompressionOverrides = {
  method: false,
  dpi: false,
  colorMode: false,
  imageQuality: false,
  monochromeThreshold: false,
};

export type CompressionSettings = {
  preset: CompressionQuality | null;
  method: CompressionMethod;
  dpi: number;
  colorMode: CompressionColorPolicy;
  imageQuality: number;
  monochromeThreshold: number;
  userOverrides: CompressionOverrides;
};

export type ApiError = {
  error?: { message?: string };
};

export type PdfOutput = {
  id: string;
  kind: "OUTPUT";
  originalName: string;
  sizeBytes: string;
  metadata?: {
    compression?: {
      sourceArtifactId?: string;
      sourceName?: string;
      sourceSizeBytes?: string;
      outcome?: "COMPRESSED" | "UNCHANGED";
      strategy?: "SKIP" | "STRUCTURAL" | "IMAGE_RECOMPRESSION" | "RASTER";
      planReason?: string;
      analysis?: {
        contentKind?: string;
        sourceDpi?: number | null;
        colorMode?: CompressionColorMode;
        hasSelectableText?: boolean;
        hasOcrLayer?: boolean;
        predominantImageEncoding?: string | null;
        optimizationClass?: string;
      } | null;
      requested?: {
        quality?: CompressionQuality | "CUSTOM";
        method?: CompressionMethod;
        dpi?: number;
        colorMode?: CompressionColorPolicy;
        imageQuality?: number;
        monochromeThreshold?: number;
      };
      applied?: {
        quality?: CompressionQuality | "CUSTOM";
        method?: CompressionMethod;
        dpi?: number;
        colorMode?: CompressionColorMode;
        imageQuality?: number;
        monochromeThreshold?: number;
      } | null;
      selectedCandidate?: {
        kind?: string;
        engine?: string;
        description?: string;
        visualTransform?: boolean;
        lossy?: boolean;
        encoding?: string | null;
        dpi?: number | null;
        colorMode?: CompressionColorMode | null;
      } | null;
      notApplied?: string[];
      preservation?: {
        textLayer?: boolean;
        annotations?: boolean;
        forms?: boolean;
        bookmarks?: boolean;
        metadata?: boolean;
        semanticValidated?: boolean;
      };
      textLayerPreserved?: boolean;
    };
  } | null;
};

export type PdfJob = {
  errorCode?: string | null;
  errorMessage: string | null;
  progress: number;
  status: string;
  artifacts: Array<PdfOutput | { id: string; kind: string }>;
};

export type WorkState = {
  phase:
    | "IDLE"
    | "UPLOADING"
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "UNCHANGED"
    | "PARTIAL";
  progress: number;
  detail: string;
};

export type PdfCompressionCompletion = {
  phase: Extract<WorkState["phase"], "SUCCEEDED" | "UNCHANGED" | "PARTIAL">;
  detail: string;
  autoDownload: boolean;
};

export function resolveCompressionCompletion(
  outputs: readonly PdfOutput[],
  errorCode?: string | null,
): PdfCompressionCompletion {
  const outcomes = outputs.map(
    (output) => output.metadata?.compression?.outcome,
  );
  const partial = errorCode === "PDF_COMPRESSION_PARTIAL";
  const allCompressed =
    !partial &&
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome === "COMPRESSED");
  const allUnchanged =
    !partial &&
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome === "UNCHANGED");

  if (partial) {
    return {
      phase: "PARTIAL",
      detail: "Compressão parcialmente concluída",
      autoDownload: false,
    };
  }

  if (allUnchanged) {
    return {
      phase: "UNCHANGED",
      detail: "Nenhuma redução obtida",
      autoDownload: false,
    };
  }

  return {
    phase: "SUCCEEDED",
    detail: "Compressão concluída",
    autoDownload: allCompressed,
  };
}

export const COMPRESSION_PRESETS = PDF_COMPRESSION_PRESETS;

export const QUALITY_OPTIONS: Array<{
  value: Exclude<CompressionQuality, "SOURCE">;
  label: string;
  description: string;
}> = [
  { value: "SCREEN", label: "Compacto", description: "96 DPI e recompressão forte" },
  { value: "BALANCED", label: "Equilibrado", description: "150 DPI com escolha automática" },
  { value: "PRINT", label: "Impressão", description: "220 DPI e maior fidelidade" },
];

export const METHOD_OPTIONS: Array<{
  value: CompressionMethod;
  label: string;
  description: string;
}> = [
  {
    value: "AUTO",
    label: "Automática",
    description: "Plano individual por PDF, preservando OCR, texto e vetores",
  },
  {
    value: "LOSSLESS",
    label: "Sem perdas",
    description: "Compactação estrutural sem alteração visual",
  },
  {
    value: "RASTER",
    label: "Recompressão visual",
    description: "Só achata páginas com opt-in explícito de perda semântica",
  },
];

export const COLOR_OPTIONS: Array<{
  value: CompressionColorPolicy;
  label: string;
  description: string;
}> = [
  {
    value: "KEEP_DETECTED",
    label: "Manter detectado",
    description: "Mantém a tonalidade individual de cada PDF",
  },
  { value: "COLOR", label: "Colorido", description: "24 bits" },
  { value: "GRAYSCALE", label: "Tons de cinza", description: "8 bits" },
  {
    value: "MONOCHROME",
    label: "Preto e branco",
    description: "1 bit · JBIG2 lossless/CCITT conforme o conteúdo",
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

export function getColorModeLabel(colorMode: CompressionColorPolicy) {
  return COLOR_OPTIONS.find((option) => option.value === colorMode)?.label;
}

export function getMedianRounded(values: number[]) {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const upper = values[middle];
  if (upper === undefined) return null;
  if (values.length % 2 !== 0) return upper;
  const lower = values[middle - 1];
  return lower === undefined ? upper : Math.round((lower + upper) / 2);
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
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(readApiError(body, `Falha ao enviar ${file.name}.`)));
    });
    request.addEventListener("error", () => {
      reject(new Error(`A conexão foi interrompida ao enviar ${file.name}.`));
    });
    request.send(file);
  });
}
