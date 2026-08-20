"use client";
// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_REVALIDATION_V1_2

import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Check,
  Download,
  FileSearch,
  FileText,
  Gauge,
  Loader2,
  Minimize2,
  Palette,
  Printer,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  analyzePdfForCompression,
  deriveCompressionRecommendation,
  type CompressionColorMode,
  type PdfCompressionAnalysis,
} from "@/lib/pdf/client-compression-analysis";
import {
  type CompressionQuality,
  type CompressionSettings,
  type ApiError,
  type PdfOutput,
  type PdfJob,
  type WorkState,
  COMPRESSION_PRESETS,
  NO_OVERRIDES,
  QUALITY_OPTIONS,
  METHOD_OPTIONS,
  COLOR_OPTIONS,
  readApiError,
  getFileKey,
  formatBytes,
  getContentKindLabel,
  getColorModeLabel,
  getMedianRounded,
  getDetectedDpiLabel,
  resolveCompressionCompletion,
  triggerDownload,
  uploadPdf
} from "./pdf-compress-workspace-model";
export * from "./pdf-compress-workspace-model";
import { PdfCompressWorkspaceView } from "./pdf-compress-workspace-view";
import { pollPdfJob } from "./pdf-job-polling";

async function mapClientWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await mapper(item, index);
      }
    }),
  );
  return results;
}

export function usePdfCompressWorkspaceController() {
  const [files, setFiles] = useState<File[]>([]);
  const [settings, setSettings] = useState<CompressionSettings | null>(null);
  const [analyses, setAnalyses] = useState<PdfCompressionAnalysis[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({
    completed: 0,
    total: 0,
  });
  const analysisRunRef = useRef(0);
  const analysisCacheRef = useRef(new WeakMap<File, PdfCompressionAnalysis>());
  const pollAbortRef = useRef<AbortController | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<PdfOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [work, setWork] = useState<WorkState>({
    phase: "IDLE",
    progress: 0,
    detail: "",
  });
  const busy =
    work.phase === "UPLOADING" ||
    work.phase === "QUEUED" ||
    work.phase === "RUNNING";

  function invalidateResult() {
    setOutputs([]);
    setJobId(null);
    setWork({ phase: "IDLE", progress: 0, detail: "" });
  }

  function applyPreset(preset: Exclude<CompressionQuality, "SOURCE">) {
    setSettings({
      preset,
      ...COMPRESSION_PRESETS[preset],
      userOverrides: { ...NO_OVERRIDES },
    });
    invalidateResult();
  }

  function applyDocumentRecommendation(
    currentAnalyses: PdfCompressionAnalysis[],
  ) {
    if (!currentAnalyses.length) return;
    setSettings({
      preset: "SOURCE",
      ...deriveCompressionRecommendation(currentAnalyses),
      userOverrides: { ...NO_OVERRIDES },
    });
    invalidateResult();
  }

  function updateSettings(
    next: Partial<
      Pick<
        CompressionSettings,
        "method" | "dpi" | "colorMode" | "imageQuality" | "monochromeThreshold"
      >
    >,
  ) {
    setSettings((current) => {
      if (!current) return current;
      const userOverrides = { ...current.userOverrides };
      if (next.method !== undefined) userOverrides.method = true;
      if (next.dpi !== undefined) userOverrides.dpi = true;
      if (next.colorMode !== undefined) userOverrides.colorMode = true;
      if (next.imageQuality !== undefined) userOverrides.imageQuality = true;
      if (next.monochromeThreshold !== undefined) {
        userOverrides.monochromeThreshold = true;
      }
      return {
        ...current,
        ...next,
        preset: null,
        userOverrides,
      };
    });
    invalidateResult();
  }

  async function analyzeFiles(nextFiles: File[]) {
    const runId = ++analysisRunRef.current;
    setSettings(null);
    setAnalysisProgress({ completed: 0, total: nextFiles.length });
    if (!nextFiles.length) {
      setAnalyses([]);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    let completed = 0;
    try {
      let failed = 0;
      const nextAnalyses = await mapClientWithConcurrency(
        nextFiles,
        2,
        async (file): Promise<PdfCompressionAnalysis | null> => {
          try {
            const key = getFileKey(file);
            const cached = analysisCacheRef.current.get(file);
            const analysis =
              cached ?? (await analyzePdfForCompression(file, key));
            if (!cached) analysisCacheRef.current.set(file, analysis);
            return analysis;
          } catch {
            failed += 1;
            return null;
          } finally {
            completed += 1;
            if (analysisRunRef.current === runId) {
              setAnalysisProgress({ completed, total: nextFiles.length });
            }
          }
        },
      );
      if (analysisRunRef.current !== runId) return;
      const validAnalyses = nextAnalyses.filter(
        (analysis): analysis is PdfCompressionAnalysis => analysis !== null,
      );
      setAnalyses(validAnalyses);
      if (validAnalyses.length) applyDocumentRecommendation(validAnalyses);
      else setSettings(null);
      if (failed) {
        setWarning(
          `${failed} arquivo(s) não puderam ser pré-analisados no navegador. ` +
            "Os demais continuam; o servidor fará a análise autoritativa.",
        );
      }
    } catch {
      if (analysisRunRef.current !== runId) return;
      setAnalyses([]);
      setSettings(null);
      setError("Não foi possível analisar este PDF. Remova o arquivo e tente novamente.");
    } finally {
      if (analysisRunRef.current === runId) setAnalyzing(false);
    }
  }
  const onDrop = (acceptedFiles: File[]) => {
    setError(null);
    setOutputs([]);
    setJobId(null);
    setWork({ phase: "IDLE", progress: 0, detail: "" });
    const next = new Map(files.map((file) => [getFileKey(file), file]));
    acceptedFiles.forEach((file) => {
      next.set(getFileKey(file), file);
    });
    const nextFiles = [...next.values()].slice(0, 20);
    const totalBytes = nextFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 500 * 1024 * 1024) {
      setError("O conjunto de arquivos ultrapassa o limite total de 500 MB.");
      return;
    }
    setFiles(nextFiles);
    void analyzeFiles(nextFiles);
  };

  function removeFile(fileKey: string) {
    const nextFiles = files.filter((file) => getFileKey(file) !== fileKey);
    setError(null);
    setOutputs([]);
    setJobId(null);
    setWork({ phase: "IDLE", progress: 0, detail: "" });
    setFiles(nextFiles);
    void analyzeFiles(nextFiles);
  }

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: { "application/pdf": [".pdf"] },
      disabled: busy || analyzing,
      maxFiles: 20,
      maxSize: 100 * 1024 * 1024,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "Cada PDF pode ter no máximo 100 MB."
        : "Selecione somente arquivos PDF válidos.",
    );
  }, [fileRejections]);

  const inputBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );
  const outputBytes = useMemo(
    () =>
      outputs.reduce((total, output) => total + Number(output.sizeBytes), 0),
    [outputs],
  );
  const matchedInputBytes = useMemo(
    () =>
      outputs.reduce(
        (total, output) =>
          total +
          Number(output.metadata?.compression?.sourceSizeBytes ?? 0),
        0,
      ),
    [outputs],
  );
  const savedPercent =
    matchedInputBytes > 0
      ? Math.round((1 - outputBytes / matchedInputBytes) * 100)
      : 0;
  const analysisSummary = useMemo(() => {
    if (!analyses.length) return null;
    const sourceDpis = analyses
      .map((analysis) => analysis.sourceDpi)
      .filter((dpi): dpi is number => dpi !== null)
      .sort((left, right) => left - right);
    const sourceDpi = getMedianRounded(sourceDpis);
    const contentKind = analyses.some(
      (analysis) => analysis.contentKind === "SCANNED" || analysis.contentKind === "SCANNED_OCR",
    )
      ? "Documento digitalizado"
      : analyses.some((analysis) => analysis.contentKind === "MIXED")
        ? "Conteúdo misto"
        : "Texto e vetores";
    const colorMode: CompressionColorMode = analyses.some(
      (analysis) => analysis.colorMode === "COLOR",
    )
      ? "COLOR"
      : analyses.some((analysis) => analysis.colorMode === "GRAYSCALE")
        ? "GRAYSCALE"
        : "MONOCHROME";

    return {
      pageCount: analyses.reduce(
        (total, analysis) => total + analysis.pageCount,
        0,
      ),
      sampledPages: analyses.reduce(
        (total, analysis) => total + analysis.sampledPages,
        0,
      ),
      sourceDpi,
      contentKind,
      colorMode,
    };
  }, [analyses]);

  async function processFiles() {
    if (!files.length || busy || analyzing || !settings) return;

    setError(null);
    setWarning(null);
    setOutputs([]);
    pollAbortRef.current?.abort();
    const pollController = new AbortController();
    pollAbortRef.current = pollController;

    try {
      const createResponse = await fetch("/api/pdf/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "COMPRESS",
          options: {
            quality: settings.preset ?? "CUSTOM",
            method: settings.method,
            dpi: settings.dpi,
            colorMode: settings.colorMode,
            imageQuality: settings.imageQuality,
            monochromeThreshold: settings.monochromeThreshold,
            userOverrides: settings.userOverrides,
            preserveTextLayer: true,
            allowSemanticLoss: false,
          },
        }),
      });
      const createBody = (await createResponse.json()) as
        | { job: { id: string } }
        | ApiError;
      if (!createResponse.ok || !("job" in createBody)) {
        throw new Error(
          readApiError(createBody, "Não foi possível iniciar a compressão."),
        );
      }

      const currentJobId = createBody.job.id;
      setJobId(currentJobId);

      const uploadProgress = new Map<number, number>();
      await mapClientWithConcurrency(files, 3, async (file, index) => {
        uploadProgress.set(index, 0);
        setWork({
          phase: "UPLOADING",
          progress: Math.round(
            [...uploadProgress.values()].reduce((sum, value) => sum + value, 0) /
              files.length,
          ),
          detail: `Enviando ${file.name}`,
        });
        await uploadPdf(currentJobId, file, (fileProgress) => {
          uploadProgress.set(index, fileProgress);
          const totalProgress = [...uploadProgress.values()].reduce(
            (sum, value) => sum + value,
            0,
          );
          setWork({
            phase: "UPLOADING",
            progress: Math.round(totalProgress / files.length),
            detail: `Enviando ${file.name}`,
          });
        });
        uploadProgress.set(index, 100);
      });

      const queueResponse = await fetch(`/api/pdf/jobs/${currentJobId}/queue`, {
        method: "POST",
      });
      const queueBody = (await queueResponse.json()) as
        | { job: PdfJob }
        | ApiError;
      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível iniciar a compressão."),
        );
      }

      setWork({
        phase: "QUEUED",
        progress: queueBody.job.progress,
        detail: "Aguardando processamento",
      });

      let finalErrorCode: string | null = null;
      const nextOutputs = await pollPdfJob({
        jobId: currentJobId,
        signal: pollController.signal,
        isOutput: (artifact): artifact is PdfOutput =>
          typeof artifact === "object" &&
          artifact !== null &&
          "kind" in artifact &&
          (artifact as { kind?: unknown }).kind === "OUTPUT",
        onConnectionIssue: (message) => {
          setWarning(message);
        },
        onUpdate: (job, currentOutputs) => {
          finalErrorCode = job.errorCode ?? null;
          setOutputs(currentOutputs);
          if (job.status === "RUNNING") {
            setWork({
              phase: "RUNNING",
              progress: job.progress,
              detail: "Analisando e compactando os arquivos",
            });
            return;
          }
          if (job.status === "SUCCEEDED") {
            const completion = resolveCompressionCompletion(
              currentOutputs,
              job.errorCode,
            );
            setWork({
              phase: completion.phase,
              progress: 100,
              detail: completion.detail,
            });
            if (job.errorMessage) setWarning(job.errorMessage);
            return;
          }
          setWork({
            phase: "QUEUED",
            progress: job.progress,
            detail: "Aguardando processamento",
          });
        },
      });

      setOutputs(nextOutputs);
      const completion = resolveCompressionCompletion(
        nextOutputs,
        finalErrorCode,
      );
      setWork({
        phase: completion.phase,
        progress: 100,
        detail: completion.detail,
      });
      const firstOutput = nextOutputs[0];
      if (!firstOutput) {
        throw new Error(
          "A compressão terminou sem gerar um arquivo para download.",
        );
      }
      if (completion.autoDownload) {
        triggerDownload(
          nextOutputs.length > 1
            ? `/api/pdf/jobs/${currentJobId}/outputs/zip`
            : `/api/pdf/jobs/${currentJobId}/outputs/${firstOutput.id}`,
        );
      }
    } catch (caught) {
      setWork({ phase: "IDLE", progress: 0, detail: "" });
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível comprimir os PDFs.",
      );
    } finally {
      if (pollAbortRef.current === pollController) {
        pollAbortRef.current = null;
      }
    }
  }

    return { Archive, ArrowLeft, ChevronDown, COLOR_OPTIONS, Check, Download, FileSearch, FileText, Gauge, Link, Loader2, METHOD_OPTIONS, Minimize2, Palette, Printer, QUALITY_OPTIONS, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X, analyses, analysisProgress, analysisSummary, analyzing, applyDocumentRecommendation, applyPreset, busy, error, files, formatBytes, getColorModeLabel, getContentKindLabel, getDetectedDpiLabel, getFileKey, getInputProps, getRootProps, inputBytes, isDragActive, jobId, outputBytes, outputs, processFiles, removeFile, savedPercent, setError, setWarning, settings, updateSettings, warning, work };
}

export function PdfCompressWorkspace() {
  return <PdfCompressWorkspaceView model={usePdfCompressWorkspaceController()} />;
}
