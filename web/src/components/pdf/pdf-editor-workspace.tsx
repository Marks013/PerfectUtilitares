"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  Check,
  Download,
  Eraser,
  Loader2,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { PdfPageThumbnail } from "@/components/pdf/pdf-page-thumbnail";
import { isAbortError, pollPdfJob } from "@/components/pdf/pdf-job-polling";
import type { PdfAnnotation, PdfManifest } from "@/lib/pdf/schema";
import {
  type EditorOperation,
  type EditorTool,
  type EditorPage,
  type ApiError,
  type OutputArtifact,
  type PdfJobResult,
  type RecoverableJob,
  TOOL_OPTIONS,
  readApiError,
  triggerDownload,
  createJob,
  uploadPdf,
  loadPdfDocument,
  EditorCanvas
} from "./pdf-editor-workspace-model";
export * from "./pdf-editor-workspace-model";
import { PdfEditorWorkspaceView } from "./pdf-editor-workspace-view";

export function usePdfEditorWorkspaceController({
  operation,
}: {
  operation: EditorOperation;
}) {
  const recoveryStarted = useRef(false);
  const processingAbort = useRef<AbortController | null>(null);
  const past = useRef<PdfAnnotation[][]>([]);
  const future = useRef<PdfAnnotation[][]>([]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [tool, setTool] = useState<EditorTool>(
    operation === "ANNOTATE" ? "HIGHLIGHT" : "TEXT",
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [processing, setProcessing] = useState<{
    output: OutputArtifact | null;
    progress: number;
    status: PdfJobResult["status"] | "IDLE";
  }>({ output: null, progress: 0, status: "IDLE" });
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState(
    operation === "ANNOTATE" ? "#facc15" : "#2563eb",
  );
  const [text, setText] = useState("Digite o texto");
  const [fontSize, setFontSize] = useState(18);
  const [opacity, setOpacity] = useState(0.35);
  const [lineWidth, setLineWidth] = useState(3);
  const [historyVersion, setHistoryVersion] = useState(0);

  const locked =
    processing.status === "QUEUED" ||
    processing.status === "RUNNING" ||
    processing.status === "SUCCEEDED";
  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const pageAnnotations = useMemo(
    () =>
      selectedPage
        ? annotations.filter(
            (annotation) => annotation.pageId === selectedPage.id,
          )
        : [],
    [annotations, selectedPage],
  );

  useEffect(
    () => () => {
      processingAbort.current?.abort();
    },
    [],
  );

  const commitAnnotations = useCallback(
    (update: (current: PdfAnnotation[]) => PdfAnnotation[]) => {
      setAnnotations((current) => {
        const next = update(current);
        if (next === current) return current;
        past.current = [...past.current.slice(-49), current];
        future.current = [];
        setHistoryVersion((version) => version + 1);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (recoveryStarted.current) return;
    recoveryStarted.current = true;
    const recoveredJobId = new URLSearchParams(window.location.search).get(
      "job",
    );
    if (!recoveredJobId) return;

    async function recoverDraft() {
      setRecovering(true);
      setError(null);
      try {
        const response = await fetch(`/api/pdf/jobs/${recoveredJobId}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as
          { job: RecoverableJob } | ApiError;
        if (!response.ok || !("job" in body)) {
          throw new Error(
            readApiError(body, "Não foi possível recuperar o rascunho."),
          );
        }
        if (body.job.status !== "DRAFT" || body.job.operation !== operation) {
          throw new Error("Este rascunho não pode mais ser editado.");
        }
        const input = body.job.artifacts.find(
          (artifact) => artifact.kind === "INPUT",
        );
        if (!input)
          throw new Error("Arquivo original do rascunho não encontrado.");

        const loadedDocument = await loadPdfDocument(body.job.id, input.id);
        const savedOptions =
          body.job.options && typeof body.job.options === "object"
            ? (body.job.options as {
                annotations?: PdfAnnotation[];
                manifest?: PdfManifest;
              })
            : {};
        const savedPages =
          savedOptions.manifest?.pages.filter(
            (page) => page.artifactId === input.id,
          ) ?? [];
        const recoveredPages =
          savedPages.length === loadedDocument.numPages
            ? savedPages
            : Array.from(
                { length: loadedDocument.numPages },
                (_, index): EditorPage => ({
                  id: crypto.randomUUID(),
                  artifactId: input.id,
                  sourcePage: index + 1,
                  rotation: 0,
                }),
              );

        setDocument(loadedDocument);
        setJobId(body.job.id);
        setFileName(input.originalName);
        setPages(recoveredPages);
        setSelectedPageId(recoveredPages[0]?.id ?? null);
        setAnnotations(savedOptions.annotations ?? []);
        setSaveState("saved");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível recuperar o rascunho.",
        );
      } finally {
        setRecovering(false);
      }
    }

    void recoverDraft();
  }, [operation]);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setError(null);
      setUploadProgress(0);

      try {
        const currentJobId = await createJob(operation);
        const artifactId = await uploadPdf(
          currentJobId,
          file,
          setUploadProgress,
        );
        const loadedDocument = await loadPdfDocument(currentJobId, artifactId);
        const importedPages = Array.from(
          { length: loadedDocument.numPages },
          (_, index): EditorPage => ({
            id: crypto.randomUUID(),
            artifactId,
            sourcePage: index + 1,
            rotation: 0,
          }),
        );

        setDocument(loadedDocument);
        setJobId(currentJobId);
        setFileName(file.name);
        setPages(importedPages);
        setSelectedPageId(importedPages[0]?.id ?? null);
        setAnnotations([]);
        past.current = [];
        future.current = [];
        setProcessing({ output: null, progress: 0, status: "IDLE" });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível abrir o arquivo selecionado.",
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [operation],
  );

  const { fileRejections, getInputProps, getRootProps, isDragActive } =
    useDropzone({
      accept: { "application/pdf": [".pdf"] },
      disabled: Boolean(uploadProgress) || locked,
      maxFiles: 1,
      maxSize: 100 * 1024 * 1024,
      multiple: false,
      onDrop,
    });

  useEffect(() => {
    if (!fileRejections.length) return;
    setError(
      fileRejections[0]?.errors[0]?.code === "file-too-large"
        ? "O PDF pode ter no máximo 100 MB."
        : "Selecione um arquivo PDF válido.",
    );
  }, [fileRejections]);

  const persist = useCallback(async () => {
    if (!jobId || !pages.length) {
      throw new Error("Adicione um PDF antes de salvar.");
    }
    setSaveState("saving");
    const response = await fetch(`/api/pdf/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations,
        manifest: { pages, version: 1 },
      }),
    });
    if (!response.ok) {
      setSaveState("error");
      throw new Error(
        readApiError(
          await response.json(),
          "Não foi possível salvar suas alterações.",
        ),
      );
    }
    setSaveState("saved");
  }, [annotations, jobId, pages]);

  useEffect(() => {
    if (!jobId || !pages.length || locked) return;
    const timer = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [jobId, locked, pages, persist]);

  async function finish() {
    if (!jobId) return;
    processingAbort.current?.abort();
    const controller = new AbortController();
    processingAbort.current = controller;
    setError(null);
    try {
      await persist();
      const queueResponse = await fetch(`/api/pdf/jobs/${jobId}/queue`, {
        method: "POST",
        signal: controller.signal,
      });
      const queueBody = (await queueResponse.json()) as
        { job: PdfJobResult } | ApiError;
      if (!queueResponse.ok || !("job" in queueBody)) {
        throw new Error(
          readApiError(queueBody, "Não foi possível iniciar o processamento."),
        );
      }

      setProcessing({
        output: null,
        progress: queueBody.job.progress,
        status:
          queueBody.job.status === "SUCCEEDED"
            ? "RUNNING"
            : queueBody.job.status,
      });

      const outputs = await pollPdfJob<
        PdfJobResult["artifacts"][number],
        OutputArtifact
      >({
        jobId,
        signal: controller.signal,
        isOutput: (artifact): artifact is OutputArtifact =>
          artifact.kind === "OUTPUT",
        onConnectionIssue(message) {
          setError(
            (current) =>
              message ??
              (current?.startsWith("Conexão com o servidor interrompida")
                ? null
                : current),
          );
        },
        onUpdate(job, validOutputs) {
          setProcessing({
            output: validOutputs[0] ?? null,
            progress: job.progress,
            status: job.status,
          });
        },
      });
      const firstOutput = outputs[0];

      if (!firstOutput) {
        throw new Error("O processamento terminou sem gerar um arquivo.");
      }

      triggerDownload(`/api/pdf/jobs/${jobId}/outputs/${firstOutput.id}`);
    } catch (caught) {
      if (isAbortError(caught)) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir o trabalho.",
      );
      setProcessing((current) => ({ ...current, status: "FAILED" }));
    } finally {
      if (processingAbort.current === controller) {
        processingAbort.current = null;
      }
    }
  }

  function undo() {
    const previous = past.current.at(-1);
    if (!previous) return;
    setAnnotations((current) => {
      future.current = [current, ...future.current].slice(0, 50);
      return previous;
    });
    past.current = past.current.slice(0, -1);
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    const next = future.current[0];
    if (!next) return;
    setAnnotations((current) => {
      past.current = [...past.current.slice(-49), current];
      return next;
    });
    future.current = future.current.slice(1);
    setHistoryVersion((version) => version + 1);
  }

    return { ArrowLeft, Check, Download, EditorCanvas, Eraser, Link, Loader2, PdfPageThumbnail, Redo2, Save, TOOL_OPTIONS, Trash2, Undo2, Upload, annotations, color, commitAnnotations, document, error, fileName, finish, fontSize, future, getInputProps, getRootProps, historyVersion, isDragActive, jobId, lineWidth, locked, opacity, operation, pageAnnotations, pages, past, processing, recovering, redo, saveState, selectedPage, setColor, setFontSize, setLineWidth, setOpacity, setSelectedPageId, setText, setTool, text, tool, triggerDownload, undo, uploadProgress };
}

export function PdfEditorWorkspace(props: Parameters<typeof usePdfEditorWorkspaceController>[0]) {
  return <PdfEditorWorkspaceView model={usePdfEditorWorkspaceController(props)} />;
}
