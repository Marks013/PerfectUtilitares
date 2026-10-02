"use client";

import { useEffect, useRef, useState } from "react";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import { MAX_FILES } from "@/lib/reajuste-salarial/limits";
import { downloadBlob } from "./download";
import { fileKey } from "./reajuste-salarial-workspace-model";
import { appendEventSettings, initialEventSettings, validateEventInputs, type EventSettings, type HistoricOverride } from "./event-adjustment-workspace-model";

export function useEventAdjustmentWorkspaceController(active: boolean, externalFiles?: File[]) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const [internalFiles, setFiles] = useState<File[]>([]);
  const files = externalFiles ?? internalFiles;
  const [fileSelectionError, setFileSelectionError] = useState<string | null>(null);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [settings, setSettings] = useState<EventSettings>({ ...initialEventSettings });
  const [overrides, setOverrides] = useState<HistoricOverride[]>([]);
  const [report, setReport] = useState<EventAdjustmentReport | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "generating" | "success" | "error">("idle");
  const [messages, setMessages] = useState<string[]>([]);
  function cancel() { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; }
  useEffect(() => { if (!active) { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; setStatus("idle"); } }, [active]);
  useEffect(() => () => { versionRef.current++; requestRef.current?.abort(); }, []);
  useEffect(() => {
    if (!externalFiles) return;
    versionRef.current++; requestRef.current?.abort(); requestRef.current = null;
    setReport(null); setMessages([]); setStatus("idle"); setDatasetVersion(current => current + 1);
    setOverrides(current => current.filter(row => externalFiles.some(file => file.name.replace(/\.xlsx$/i, "") === row.competencyKey)));
  }, [externalFiles]);
  function invalidate() { cancel(); setReport(null); setMessages([]); setStatus("idle"); }
  function reset() {
    invalidate(); setDatasetVersion(current => current + 1); setFiles([]); setFileSelectionError(null); setSettings({ ...initialEventSettings }); setOverrides([]);
    if (inputRef.current) inputRef.current.value = "";
  }
  async function run(pdf = false) {
    if (!active) return;
    const errors = validateEventInputs(files, settings, overrides);
    if (pdf && (!report || report.issueCount || (!settings.bonusNewValue.trim() && !settings.sundayNewValue.trim()))) errors.push("Apure as bases sem pendências e configure pelo menos um novo valor antes de gerar o PDF.");
    if (errors.length) { setMessages(errors); setStatus("error"); return; }
    cancel(); const version = versionRef.current; const controller = new AbortController(); requestRef.current = controller;
    const data = new FormData();
    for (const file of files) data.append("files", file, file.name);
    appendEventSettings(data, settings, overrides);
    setMessages([]); setStatus(pdf ? "generating" : "analyzing");
    try {
      const response = await fetch(`/api/reajuste-salarial/eventos/${pdf ? "gerar" : "analisar"}`, { method: "POST", body: data, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json();
        const details = body.error?.details?.map((item: { message?: string }) => item.message).filter(Boolean) ?? [];
        if (version !== versionRef.current) return;
        setMessages([body.error?.message ?? "Não foi possível apurar os eventos.", ...details]); setStatus("error"); return;
      }
      if (pdf) {
        if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Resposta PDF inválida.");
        const blob = await response.blob(); if (version !== versionRef.current) return;
        const header = response.headers.get("content-disposition");
        const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        downloadBlob(blob, encoded ? decodeURIComponent(encoded) : header?.match(/filename="?([^";]+)"?/i)?.[1] ?? "reajuste-eventos.pdf");
        setMessages(["PDF gerado. Download iniciado."]); setStatus("success");
      } else {
        const body = await response.json(); if (version !== versionRef.current) return;
        setReport(body.report); setStatus("idle");
      }
    } catch (error) {
      if (version !== versionRef.current || controller.signal.aborted) return;
      setMessages([error instanceof Error && error.message === "Resposta PDF inválida." ? error.message : "Falha de conexão. Tente novamente."]); setStatus("error");
    } finally { if (version === versionRef.current) requestRef.current = null; }
  }
  return { files, fileSelectionError, datasetVersion, settings, overrides, report, status, messages, inputRef, reset,
    busy: status === "analyzing" || status === "generating",
    canGenerate: Boolean(report && report.issueCount === 0 && (settings.bonusNewValue.trim() || settings.sundayNewValue.trim())),
    analyze: () => run(), generate: () => run(true),
    mergeIncoming: (incoming: File[]) => {
      const merged = new Map(files.map(file => [fileKey(file), file]));
      for (const file of incoming) merged.set(fileKey(file), file);
      if (merged.size > MAX_FILES) {
        setFileSelectionError(`Seleção não adicionada: o limite é de ${MAX_FILES} bases. Remova uma base antes de incluir outra; os arquivos e a apuração anteriores foram preservados.`);
        return;
      }
      invalidate(); setFileSelectionError(null); setDatasetVersion(current => current + 1); setFiles([...merged.values()]);
    },
    removeFile: (key: string) => { invalidate(); setFileSelectionError(null); setDatasetVersion(current => current + 1); setFiles(current => current.filter(file => fileKey(file) !== key)); setOverrides(current => current.filter(row => !files.some(file => fileKey(file) === key && file.name.replace(/\.xlsx$/i, "") === row.competencyKey))); },
    updateSetting: (key: keyof EventSettings, value: string) => { invalidate(); setSettings(current => ({ ...current, [key]: value })); },
    updateOverride: (competencyKey: string, key: "bonusOldValue" | "sundayOldValue", value: string) => { invalidate(); setOverrides(current => { const existing = current.find(row => row.competencyKey === competencyKey); return [...current.filter(row => row.competencyKey !== competencyKey), { competencyKey, bonusOldValue: "", sundayOldValue: "", ...existing, [key]: value }]; }); },
  };
}
