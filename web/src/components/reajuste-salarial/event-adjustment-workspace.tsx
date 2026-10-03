"use client";

import { useEffect, useRef, useState } from "react";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import type { SalaryAdvanceScope } from "@/lib/reajuste-salarial/types";
import { appendEventSettings, initialEventSettings, validateEventInputs, type EventSettings, type HistoricOverride } from "./event-adjustment-workspace-model";

export function useEventAdjustmentWorkspaceController(active: boolean, files: File[], salaryScope: SalaryAdvanceScope = "standard") {
  const requestRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [settings, setSettings] = useState<EventSettings>({ ...initialEventSettings });
  const [overrides, setOverrides] = useState<HistoricOverride[]>([]);
  const [report, setReport] = useState<EventAdjustmentReport | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const [messages, setMessages] = useState<string[]>([]);
  function cancel() { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; }
  useEffect(() => { if (!active) { versionRef.current++; requestRef.current?.abort(); requestRef.current = null; setStatus("idle"); } }, [active]);
  useEffect(() => () => { versionRef.current++; requestRef.current?.abort(); }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A union change invalidates the preview while keeping the same files.
  useEffect(() => {
    versionRef.current++; requestRef.current?.abort(); requestRef.current = null;
    setReport(null); setMessages([]); setStatus("idle"); setDatasetVersion(current => current + 1);
    setOverrides(current => current.filter(row => files.some(file => file.name.replace(/\.xlsx$/i, "") === row.competencyKey)));
  }, [files, salaryScope]);
  function invalidate() { cancel(); setReport(null); setMessages([]); setStatus("idle"); }
  function reset() {
    invalidate(); setDatasetVersion(current => current + 1); setSettings({ ...initialEventSettings }); setOverrides([]);
  }
  async function analyze() {
    if (!active) return;
    const errors = validateEventInputs(files, settings, overrides);
    if (errors.length) { setMessages(errors); setStatus("error"); return; }
    cancel(); const version = versionRef.current; const controller = new AbortController(); requestRef.current = controller;
    const data = new FormData();
    for (const file of files) data.append("files", file, file.name);
    data.set("salaryScope", salaryScope);
    appendEventSettings(data, settings, overrides);
    setMessages([]); setStatus("analyzing");
    try {
      const response = await fetch("/api/reajuste-salarial/eventos/analisar", { method: "POST", body: data, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json();
        const details = body.error?.details?.map((item: { message?: string }) => item.message).filter(Boolean) ?? [];
        if (version !== versionRef.current) return;
        setMessages([body.error?.message ?? "Não foi possível apurar os eventos.", ...details]); setStatus("error"); return;
      }
      const body = await response.json(); if (version !== versionRef.current) return;
      setReport(body.report); setStatus("idle");
    } catch {
      if (version !== versionRef.current || controller.signal.aborted) return;
      setMessages(["Falha de conexão. Tente novamente."]); setStatus("error");
    } finally { if (version === versionRef.current) requestRef.current = null; }
  }
  return { files, datasetVersion, settings, overrides, report, status, messages, reset,
    busy: status === "analyzing",
    canGenerate: Boolean(report && report.issueCount === 0 && (settings.bonusNewValue.trim() || settings.sundayNewValue.trim())),
    analyze,
    updateSetting: (key: keyof EventSettings, value: string) => { invalidate(); setSettings(current => ({ ...current, [key]: value })); },
    updateOverride: (competencyKey: string, key: "bonusOldValue" | "sundayOldValue", value: string) => { invalidate(); setOverrides(current => { const existing = current.find(row => row.competencyKey === competencyKey); return [...current.filter(row => row.competencyKey !== competencyKey), { competencyKey, bonusOldValue: "", sundayOldValue: "", ...existing, [key]: value }]; }); },
  };
}
