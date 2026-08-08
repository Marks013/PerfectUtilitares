"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  Download,
  FileSearch,
  FileText,
  Gauge,
  Loader2,
  Minimize2,
  Palette,
  ScanLine,
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
  triggerDownload,
  wait,
  uploadPdf
} from "./pdf-compress-workspace-model";
export * from "./pdf-compress-workspace-model";
import { PdfCompressWorkspaceView } from "./pdf-compress-workspace-view";

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
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<PdfOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<WorkState>({
    phase: "IDLE",
    progress: 0,
    detail: "",
  });
  const busy =
    work.phase === "UPLOADING" ||
    work.phase === "QUEUED" ||
    work.phase === "RUNNING";

  function applyPreset(preset: Exclude<CompressionQuality, "SOURCE">) {
    setSettings({
      preset,
      ...COMPRESSION_PRESETS[preset],
    });
  }

  function applyDocumentRecommendation(
    currentAnalyses: PdfCompressionAnalysis[],
  ) {
    if (!currentAnalyses.length) return;
    setSettings({
      preset: "SOURCE",
      ...deriveCompressionRecommendation(currentAnalyses),
    });
  }

  function updateSettings(next: Partial<Omit<CompressionSettings, "preset">>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            ...next,
            preset: null,
          }
        : current,
    );
  }

  async function analyzeFiles(nextFiles: File[]) {
    const runId = ++analysisRunRef.current;
    setAnalyses([]);
    setSettings(null);
    setAnalysisProgress({ completed: 0, total: nextFiles.length });

    if (!nextFiles.length) {
      setAnalyzing(false);
      return;
    }

    setAnalyzing(true);
    const nextAnalyses: PdfCompressionAnalysis[] = [];

    try {
      for (const [index, file] of nextFiles.entries()) {
        const analysis = await analyzePdfForCompression(file, getFileKey(file));
        if (analysisRunRef.current !== runId) return;
        nextAnalyses.push(analysis);
        setAnalyses([...nextAnalyses]);
        setAnalysisProgress({
          completed: index + 1,
          total: nextFiles.length,
        });
      }
      applyDocumentRecommendation(nextAnalyses);
    } catch {
      if (analysisRunRef.current !== runId) return;
      setAnalyses([]);
      setSettings(null);
      setError(
        "Não foi possível analisar este PDF. Remova o arquivo e tente novamente.",
      );
    } finally {
      if (analysisRunRef.current === runId) {
        setAnalyzing(false);
      }
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
  const savedPercent =
    inputBytes > 0 ? Math.round((1 - outputBytes / inputBytes) * 100) : 0;
  const analysisSummary = useMemo(() => {
    if (!analyses.length) return null;
    const sourceDpis = analyses
      .map((analysis) => analysis.sourceDpi)
      .filter((dpi): dpi is number => dpi !== null)
      .sort((left, right) => left - right);
    const sourceDpi = getMedianRounded(sourceDpis);
    const contentKind = analyses.some(
      (analysis) => analysis.contentKind === "SCANNED",
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
    setOutputs([]);

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

      for (const [index, file] of files.entries()) {
        setWork({
          phase: "UPLOADING",
          progress: Math.round((index / files.length) * 100),
          detail: `Enviando ${file.name}`,
        });
        await uploadPdf(currentJobId, file, (fileProgress) => {
          setWork({
            phase: "UPLOADING",
            progress: Math.round(
              ((index + fileProgress / 100) / files.length) * 100,
            ),
            detail: `Enviando ${file.name}`,
          });
        });
      }

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

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await wait(1_000);
        const response = await fetch(`/api/pdf/jobs/${currentJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as { job: PdfJob } | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível acompanhar a compressão."),
          );
        }

        const nextOutputs = body.job.artifacts.filter(
          (artifact): artifact is PdfOutput => artifact.kind === "OUTPUT",
        );
        if (body.job.status === "SUCCEEDED") {
          setOutputs(nextOutputs);
          setWork({
            phase: "SUCCEEDED",
            progress: 100,
            detail: "Compressão concluída",
          });
          const firstOutput = nextOutputs[0];

          if (!firstOutput) {
            throw new Error(
              "A compressão terminou sem gerar um arquivo para download.",
            );
          }

          triggerDownload(
            nextOutputs.length > 1
              ? `/api/pdf/jobs/${currentJobId}/outputs/zip`
              : `/api/pdf/jobs/${currentJobId}/outputs/${firstOutput.id}`,
          );
          return;
        }

        if (
          body.job.status === "FAILED" ||
          body.job.status === "CANCELLED" ||
          body.job.status === "EXPIRED"
        ) {
          throw new Error(
            body.job.errorMessage ?? "A compressão não pôde ser concluída.",
          );
        }

        setWork({
          phase: body.job.status === "RUNNING" ? "RUNNING" : "QUEUED",
          progress: body.job.progress,
          detail:
            body.job.status === "RUNNING"
              ? "Recomprimindo páginas e comparando resultados"
              : "Aguardando processamento",
        });
      }

      throw new Error("A compressão demorou além do esperado.");
    } catch (caught) {
      setWork({ phase: "IDLE", progress: 0, detail: "" });
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível comprimir os PDFs.",
      );
    }
  }

    return { Archive, ArrowLeft, COLOR_OPTIONS, Check, Download, FileSearch, FileText, Gauge, Link, Loader2, METHOD_OPTIONS, Minimize2, Palette, QUALITY_OPTIONS, ScanLine, Upload, X, analyses, analysisProgress, analysisSummary, analyzing, applyDocumentRecommendation, applyPreset, busy, error, files, formatBytes, getColorModeLabel, getContentKindLabel, getDetectedDpiLabel, getFileKey, getInputProps, getRootProps, inputBytes, isDragActive, jobId, outputBytes, outputs, processFiles, removeFile, savedPercent, setError, settings, updateSettings, work };
}

export function PdfCompressWorkspace() {
  return <PdfCompressWorkspaceView model={usePdfCompressWorkspaceController()} />;
}
