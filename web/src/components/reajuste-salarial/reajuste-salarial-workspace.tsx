"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "./download";
import {
  fileKey,
  type GenerationState,
  validateGeneration,
} from "./reajuste-salarial-workspace-model";
import { ReajusteSalarialWorkspaceView } from "./reajuste-salarial-workspace-view";
import { useSalaryRevisionWorkspaceController } from "./salary-revision-workspace";
import { useEventAdjustmentWorkspaceController } from "./event-adjustment-workspace";
import { appendEventSettings, validateEventInputs } from "./event-adjustment-workspace-model";
import { MAX_FILES } from "@/lib/reajuste-salarial/limits";
import type { SalaryAdvancePdfKind, SalaryAdvanceScope } from "@/lib/reajuste-salarial/types";

function downloadName(header: string | null, kind: SalaryAdvancePdfKind) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header?.match(/filename="?([^";]+)"?/i)?.[1] ?? `antecipacao-salarial-${kind === "summary" ? "resumo-consolidado" : "detalhado"}.pdf`;
}

async function responseMessages(blob: Blob) {
  try {
    const body = JSON.parse(await blob.text()) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
    };
    const details = body.error?.details
      ?.map((item) => item.message)
      .filter((item): item is string => Boolean(item));
    return details?.length
      ? [body.error?.message ?? "Não foi possível gerar o PDF.", ...details]
      : [body.error?.message ?? "Não foi possível gerar o PDF."];
  } catch {
    return ["Não foi possível gerar o PDF."];
  }
}

export function useSalaryAdvanceWorkspaceController(active = true) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [percentage, setPercentage] = useState("");
  const [packerPercentage, setPackerPercentage] = useState("");
  const [calculatorResetVersion, setCalculatorResetVersion] = useState(0);
  const [salaryScope, setSalaryScope] = useState<SalaryAdvanceScope>("standard");
  const [driverPercentage, setDriverPercentage] = useState("");
  const [includeEvents, setIncludeEvents] = useState(false);
  const [excludeAbsentLatest, setExcludeAbsentLatest] = useState(false);
  const [fileSelectionError, setFileSelectionError] = useState<string | null>(null);
  const eventModel = useEventAdjustmentWorkspaceController(active && includeEvents, files, salaryScope, excludeAbsentLatest);
  const [state, setState] = useState<GenerationState>({ status: "idle", progress: 0 });
  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const busy = state.status === "uploading" || state.status === "processing" || eventModel.busy;
  const canGenerate = validateGeneration(files, percentage, packerPercentage, salaryScope, driverPercentage).length === 0 && (!includeEvents || eventModel.canGenerate);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Changes to any generation input invalidate the pending PDF, even while its body is being read.
  useEffect(() => {
    requestRef.current?.abort(); requestRef.current = null;
    setState(current => current.status === "uploading" || current.status === "processing" ? { status: "idle", progress: 0 } : current);
  }, [active, includeEvents, excludeAbsentLatest, files, percentage, packerPercentage, salaryScope, driverPercentage, eventModel.settings, eventModel.overrides]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  function releaseFiles() {
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function reset() {
    requestRef.current?.abort();
    requestRef.current = null;
    releaseFiles();
    setPercentage("");
    setPackerPercentage("");
    setCalculatorResetVersion(current => current + 1);
    setSalaryScope("standard");
    setDriverPercentage("");
    setIncludeEvents(false);
    setExcludeAbsentLatest(false);
    setFileSelectionError(null);
    eventModel.reset();
    setState({ status: "idle", progress: 0 });
  }

  function removeFile(key: string) {
    requestRef.current?.abort(); requestRef.current = null;
    setFileSelectionError(null);
    setFiles((current) => current.filter((file) => fileKey(file) !== key));
    setState({ status: "idle", progress: 0 });
  }

  function generate(kind: SalaryAdvancePdfKind = "detailed") {
    if (!active || busy) return;
    const messages = validateGeneration(files, percentage, packerPercentage, salaryScope, driverPercentage);
    if (includeEvents) {
      messages.push(...validateEventInputs(files, eventModel.settings, eventModel.overrides));
      if (!eventModel.canGenerate) messages.push("Apure os eventos sem pendências e configure pelo menos um novo valor antes de gerar os relatórios.");
    }
    if (messages.length > 0) {
      setState({ status: "error", progress: 0, messages });
      return;
    }

    const data = new FormData();
    for (const file of files) data.append("files", file, file.name);
    data.set("percentage", percentage.trim());
    data.set("packerPercentage", packerPercentage.trim());
    data.set("reportType", kind);
    data.set("salaryScope", salaryScope);
    data.set("excludeAbsentLatest", String(excludeAbsentLatest));
    if (salaryScope === "drivers-forklift") data.set("driverPercentage", driverPercentage.trim());
    if (includeEvents) {
      data.set("includeEvents", "true");
      appendEventSettings(data, eventModel.settings, eventModel.overrides);
    }
    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/reajuste-salarial/gerar");
    request.responseType = "blob";
    setState({ status: "uploading", progress: 0, pdfKind: kind });
    request.upload.addEventListener("progress", (event) => {
      if (requestRef.current !== request) return;
      if (!event.lengthComputable) return;
      setState({
        status: "uploading",
        progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
        pdfKind: kind,
      });
    });
    request.upload.addEventListener("load", () => {
      if (requestRef.current !== request) return;
      setState({ status: "processing", progress: 100, pdfKind: kind });
    });
    request.addEventListener("load", async () => {
      if (requestRef.current !== request) return;
      const blob = request.response as Blob;
      const contentType = request.getResponseHeader("content-type") ?? "";
      if (request.status >= 200 && request.status < 300 && contentType.includes("application/pdf")) {
        const fileName = downloadName(request.getResponseHeader("content-disposition"), kind);
        downloadBlob(blob, fileName);
        requestRef.current = null;
        setState({ status: "success", progress: 100, fileName, pdfKind: kind });
        return;
      }
      const messages = await responseMessages(blob);
      if (requestRef.current !== request) return;
      requestRef.current = null;
      setState({ status: "error", progress: 0, messages });
    });
    request.addEventListener("error", () => {
      if (requestRef.current !== request) return;
      requestRef.current = null;
      setState({
        status: "error",
        progress: 0,
        messages: ["Falha de conexão. Tente novamente."],
      });
    });
    request.addEventListener("abort", () => {
      if (requestRef.current === request) requestRef.current = null;
    });
    request.send(data);
  }

  return {
    busy,
    canGenerate,
    eventModel,
    includeEvents,
    setIncludeEvents,
    excludeAbsentLatest,
    setExcludeAbsentLatest,
    fileSelectionError,
    files,
    generate,
    inputRef,
    mergeIncoming: (incoming: File[]) => {
      const merged = new Map(files.map(file => [fileKey(file), file]));
      for (const file of incoming) merged.set(fileKey(file), file);
      if (merged.size > MAX_FILES) {
        setFileSelectionError(`Seleção não adicionada: o limite é de ${MAX_FILES} bases. Remova uma base antes de incluir outra; os arquivos e a apuração anteriores foram preservados.`);
        return;
      }
      requestRef.current?.abort(); requestRef.current = null;
      setFileSelectionError(null);
      setFiles([...merged.values()]);
      setState({ status: "idle", progress: 0 });
    },
    percentage,
    packerPercentage,
    salaryScope,
    setSalaryScope,
    driverPercentage,
    setDriverPercentage,
    calculatorResetVersion,
    removeFile,
    reset,
    setPercentage,
    setPackerPercentage,
    state,
    totalBytes,
  };
}

export function ReajusteSalarialWorkspace() {
  const [mode, setMode] = useState<"advance" | "revision">("advance");
  const advanceModel = useSalaryAdvanceWorkspaceController(mode === "advance");
  return (
    <ReajusteSalarialWorkspaceView
      advanceModel={advanceModel}
      mode={mode}
      onModeChange={setMode}
      revisionModel={useSalaryRevisionWorkspaceController()}
    />
  );
}
