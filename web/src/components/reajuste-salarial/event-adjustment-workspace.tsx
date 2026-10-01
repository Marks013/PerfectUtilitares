"use client";

import { useEffect, useRef, useState } from "react";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import { downloadBlob } from "./download";
import { fileKey, mergeFiles } from "./reajuste-salarial-workspace-model";
import { initialEventSettings, validateEventInputs, type EventSettings, type HistoricOverride } from "./event-adjustment-workspace-model";

export function useEventAdjustmentWorkspaceController(active: boolean) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const [files, setFiles] = useState<File[]>([]);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [settings, setSettings] = useState<EventSettings>({ ...initialEventSettings });
  const [overrides, setOverrides] = useState<HistoricOverride[]>([]);
  const [report, setReport] = useState<EventAdjustmentReport | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "generating" | "success" | "error">("idle");
  const [messages, setMessages] = useState<string[]>([]);
  function cancel() { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; }
  useEffect(() => { if (!active) { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; setStatus("idle"); } }, [active]);
  useEffect(() => () => { versionRef.current++; requestRef.current?.abort(); }, []);
  function invalidate() { cancel(); setReport(null); setMessages([]); setStatus("idle"); }
  function reset() {
    invalidate(); setDatasetVersion(current => current + 1); setFiles([]); setSettings({ ...initialEventSettings }); setOverrides([]);
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
    for (const [key, value] of Object.entries(settings)) data.set(key, value.trim());
    data.set("historicOverrides", JSON.stringify(overrides.filter(row => row.bonusOldValue.trim() || row.sundayOldValue.trim()).map(row => ({ competencyKey: row.competencyKey, bonusOldValue: row.bonusOldValue.trim() || settings.bonusOldValue.trim(), sundayOldValue: row.sundayOldValue.trim() || settings.sundayOldValue.trim() }))));
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
  return { files, datasetVersion, settings, overrides, report, status, messages, inputRef, reset,
    busy: status === "analyzing" || status === "generating",
    canGenerate: Boolean(report && report.issueCount === 0 && (settings.bonusNewValue.trim() || settings.sundayNewValue.trim())),
    analyze: () => run(), generate: () => run(true),
    mergeIncoming: (incoming: File[]) => { invalidate(); setDatasetVersion(current => current + 1); setFiles(current => mergeFiles(current, incoming)); },
    removeFile: (key: string) => { invalidate(); setDatasetVersion(current => current + 1); setFiles(current => current.filter(file => fileKey(file) !== key)); setOverrides(current => current.filter(row => !files.some(file => fileKey(file) === key && file.name.replace(/\.xlsx$/i, "") === row.competencyKey))); },
    updateSetting: (key: keyof EventSettings, value: string) => { invalidate(); setSettings(current => ({ ...current, [key]: value })); },
    updateOverride: (competencyKey: string, key: "bonusOldValue" | "sundayOldValue", value: string) => { invalidate(); setOverrides(current => { const existing = current.find(row => row.competencyKey === competencyKey); return [...current.filter(row => row.competencyKey !== competencyKey), { competencyKey, bonusOldValue: "", sundayOldValue: "", ...existing, [key]: value }]; }); },
  };
}
