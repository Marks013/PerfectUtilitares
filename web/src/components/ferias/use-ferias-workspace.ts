"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisSchema, type FeriasAnalysis, type FeriasChoice,
  readResponseError, validateVacationFile,
} from "./ferias-contract";

type Phase = "idle" | "analyzing" | "exporting";
type Download = { url: string; name: string };

export function useFeriasWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<FeriasAnalysis | null>(null);
  const [choices, setChoices] = useState<FeriasChoice[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<Download | null>(null);
  const request = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const busy = phase !== "idle";

  const invalidate = useCallback(() => {
    request.current.controller?.abort();
    request.current = { id: request.current.id + 1 };
  }, []);

  useEffect(() => invalidate, [invalidate]);
  useEffect(() => {
    if (!download) return;
    // Keep a consumed link alive while the browser starts its download.
    return () => { globalThis.setTimeout(() => URL.revokeObjectURL(download.url), 60_000); };
  }, [download]);

  function selectFile(next: File | null) {
    invalidate();
    const issue = next ? validateVacationFile(next) : null;
    setFile(issue ? null : next);
    setError(issue);
    setAnalysis(null);
    setChoices([]);
    setDownload(null);
    setStale(false);
    setPhase("idle");
  }

  function choose(row: number, field: "holderId" | "loanIdentity", value: string) {
    invalidate();
    setChoices((current) => {
      const choice = { ...current.find((item) => item.row === row), row };
      choice[field] = value || undefined;
      return [...current.filter((item) => item.row !== row), choice];
    });
    setStale(true);
    setDownload(null);
    setError(null);
    setPhase("idle");
  }

  async function run(operation: "analisar" | "exportar") {
    if (!file || busy || (operation === "exportar" && (!analysis?.canExport || stale))) return;
    invalidate();
    const controller = new AbortController();
    const id = request.current.id;
    request.current.controller = controller;
    const current = () => request.current.id === id && !controller.signal.aborted;
    setPhase(operation === "analisar" ? "analyzing" : "exporting");
    setError(null);
    setDownload(null);
    if (operation === "analisar") setStale(true);
    const timeout = globalThis.setTimeout(() => {
      if (!current()) return;
      invalidate();
      setStale(true);
      setPhase("idle");
      setError("A operação levou mais tempo que o esperado. Tente analisar novamente.");
    }, 120_000);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("choices", JSON.stringify(choices));
      if (operation === "exportar" && analysis) body.set("revision", analysis.revision);
      const response = await fetch(`/api/admin/ferias/${operation}`, {
        method: "POST", body, signal: controller.signal, cache: "no-store",
      });
      if (!current()) return;
      if (!response.ok) {
        const message = await readResponseError(response);
        if (current()) {
          setError(message);
          if (response.status === 409 || response.status === 401 || response.status === 403) setStale(true);
        }
        return;
      }
      if (operation === "analisar") {
        const parsed = analysisSchema.safeParse(await response.json());
        if (!current()) return;
        if (!parsed.success) throw new Error("invalid-response");
        setAnalysis(parsed.data);
        setStale(false);
      } else {
        if (!response.headers.get("content-type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
          throw new Error("invalid-download");
        }
        const blob = await response.blob();
        if (!current()) return;
        if (!blob.size) throw new Error("empty-download");
        if (!analysis) return;
        const [year, month] = analysis.competency.split("-");
        const result = { url: URL.createObjectURL(blob), name: `FERIAS-${month}-${year}-CONFERIDO.xlsx` };
        setDownload(result);
        const link = document.createElement("a");
        link.href = result.url;
        link.download = result.name;
        document.body.append(link);
        link.click();
        link.remove();
      }
    } catch {
      if (current()) setError("Não foi possível concluir. Confira sua conexão e tente novamente.");
    } finally {
      globalThis.clearTimeout(timeout);
      if (current()) {
        request.current.controller = undefined;
        setPhase("idle");
      }
    }
  }

  function cancel() {
    invalidate();
    setPhase("idle");
    setError(null);
  }

  return { file, analysis, choices, phase, busy, stale, error, download, selectFile, choose, run, cancel };
}
