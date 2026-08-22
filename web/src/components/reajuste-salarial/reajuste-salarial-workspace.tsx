"use client";

import { useMemo, useRef, useState } from "react";
import {
  fileKey,
  mergeFiles,
  type GenerationState,
  validateGeneration,
} from "./reajuste-salarial-workspace-model";
import { ReajusteSalarialWorkspaceView } from "./reajuste-salarial-workspace-view";

function downloadName(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header?.match(/filename="?([^";]+)"?/i)?.[1] ?? "reajuste-salarial.pdf";
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

export function useReajusteSalarialWorkspaceController() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [percentage, setPercentage] = useState("");
  const [state, setState] = useState<GenerationState>({ status: "idle", progress: 0 });
  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const busy = state.status === "uploading" || state.status === "processing";

  function releaseFiles() {
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function reset() {
    requestRef.current?.abort();
    requestRef.current = null;
    releaseFiles();
    setPercentage("");
    setState({ status: "idle", progress: 0 });
  }

  function removeFile(key: string) {
    setFiles((current) => current.filter((file) => fileKey(file) !== key));
    setState({ status: "idle", progress: 0 });
  }

  function generate() {
    const messages = validateGeneration(files, percentage);
    if (messages.length > 0) {
      setState({ status: "error", progress: 0, messages });
      return;
    }

    const data = new FormData();
    for (const file of files) data.append("files", file, file.name);
    data.set("percentage", percentage.trim());
    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/reajuste-salarial/gerar");
    request.responseType = "blob";
    setState({ status: "uploading", progress: 0 });
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setState({
        status: "uploading",
        progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
      });
    });
    request.upload.addEventListener("load", () => {
      setState({ status: "processing", progress: 100 });
    });
    request.addEventListener("load", async () => {
      requestRef.current = null;
      const blob = request.response as Blob;
      const contentType = request.getResponseHeader("content-type") ?? "";
      if (request.status >= 200 && request.status < 300 && contentType.includes("application/pdf")) {
        const fileName = downloadName(request.getResponseHeader("content-disposition"));
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        releaseFiles();
        setState({ status: "success", progress: 100, fileName });
        return;
      }
      releaseFiles();
      setState({ status: "error", progress: 0, messages: await responseMessages(blob) });
    });
    request.addEventListener("error", () => {
      requestRef.current = null;
      releaseFiles();
      setState({
        status: "error",
        progress: 0,
        messages: ["Falha de conexão. Selecione os arquivos e tente novamente."],
      });
    });
    request.addEventListener("abort", () => {
      requestRef.current = null;
    });
    request.send(data);
  }

  return {
    busy,
    files,
    generate,
    inputRef,
    mergeIncoming: (incoming: File[]) => {
      setFiles((current) => mergeFiles(current, incoming));
      setState({ status: "idle", progress: 0 });
    },
    percentage,
    removeFile,
    reset,
    setPercentage,
    state,
    totalBytes,
  };
}

export function ReajusteSalarialWorkspace() {
  return (
    <ReajusteSalarialWorkspaceView
      model={useReajusteSalarialWorkspaceController()}
    />
  );
}
