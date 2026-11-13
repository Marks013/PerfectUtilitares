"use client";

import { useEffect, useRef, useState } from "react";
import { OPERATIONAL_REPORT_CONTENT_TYPE, OPERATIONAL_REPORT_PATH, OPERATIONAL_REPORT_PRESETS, OPERATIONAL_REPORT_SECTION_LABELS, OPERATIONAL_REPORT_SECTIONS, operationalReportCapabilities, operationalReportOptionsSchema, serializeOperationalReportQuery, validateOperationalReportSelection, type OperationalReportSection } from "@/lib/escalas/operational-report-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";

export function OperationalReports({ workspace, disabled }: { workspace: EscalaWorkspace; disabled: boolean }) {
  const input = workspace.input;
  const month = input.visibleMonth ?? "";
  const mode = input.generationMode ?? "DAYS_AND_HOURS";
  const hasRoster = input.assignments.some(day => day.kind === "WORK" || day.kind === "DUTY" || day.kind === "OFF");
  const capabilities = operationalReportCapabilities(mode, hasRoster);
  const available = OPERATIONAL_REPORT_SECTIONS.filter(section => capabilities.sections.includes(section));
  const sectors = [...new Set(input.employees.map(person => person.sector).filter(sector => sector.trim()))].sort();
  const inFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const context = `${workspace.id}:${workspace.revision}`;
  const currentContext = useRef(context); currentContext.current = context;
  useEffect(() => { void context; setStage("ready"); setMessage(""); return () => { activeRequest.current?.abort(); activeRequest.current = null; inFlight.current = false; }; }, [context]);
  const [sections, setSections] = useState<OperationalReportSection[]>(() => hasRoster ? [...OPERATIONAL_REPORT_PRESETS.monthly.sections] : [...OPERATIONAL_REPORT_PRESETS.references.sections]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [stage, setStage] = useState<"ready" | "processing" | "done" | "warning" | "error">("ready");
  const [message, setMessage] = useState("");
  const selected = sections.filter(section => available.includes(section));
  const selectedValidSectors = selectedSectors.filter(sector => sectors.includes(sector));
  function preset(key: keyof typeof OPERATIONAL_REPORT_PRESETS) {
    setSections(OPERATIONAL_REPORT_PRESETS[key].sections.filter(section => available.includes(section)));
    setStage("ready"); setMessage("");
  }
  async function download() {
    if (inFlight.current || disabled) return;
    const parsed = operationalReportOptionsSchema.safeParse({ workspaceId: workspace.id, revision: workspace.revision, month, format: "pdf", sections: selected, sectors: selectedValidSectors, ...(date && (selected.includes("presence") || selected.includes("coverage")) ? { date } : {}) });
    if (!parsed.success) { setStage("warning"); setMessage(parsed.error.issues[0]?.message ?? "Confira as opções do relatório."); return; }
    const issues = validateOperationalReportSelection(parsed.data, { workspaceId: workspace.id, revision: workspace.revision, visibleMonth: month, generationMode: mode, hasRoster, sectors });
    if (issues.length) { setStage("warning"); setMessage(issues[0].message); return; }
    inFlight.current = true;
    const controller = new AbortController(); activeRequest.current = controller;
    const valid = () => activeRequest.current === controller && !controller.signal.aborted && currentContext.current === context;
    setStage("processing"); setMessage("");
    try {
      const response = await fetch(`${OPERATIONAL_REPORT_PATH}?${serializeOperationalReportQuery(parsed.data)}`, { cache: "no-store", signal: controller.signal });
      if (!valid()) return;
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
        const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(response.status === 409 ? "A revisão mudou. Reabra o planejamento e confira o relatório novamente." : typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "Não foi possível preparar o relatório. Tente novamente.");
      }
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes(OPERATIONAL_REPORT_CONTENT_TYPE)) throw new Error("O servidor não retornou um PDF válido.");
      const blob = await response.blob();
      if (!valid()) return;
      if (!blob.size) throw new Error("O PDF retornado está vazio.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `relatorio-operacional-${month}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStage("done"); setMessage("PDF preparado para download.");
    } catch (cause) { if (valid()) { setStage("error"); setMessage(cause instanceof Error ? cause.message : "Não foi possível preparar o relatório."); } }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; inFlight.current = false; } }
  }
  const labels = { ready: "Pronto", processing: "Processando", done: "Concluído", warning: "Aviso", error: "Falha" };
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Relatórios operacionais (opcional)</summary>
    <div className={`${styles.disclosureBody} ${styles.stackSmall}`}>
      <p className={styles.muted}>PDF desta filial: {input.branchCode} · mês {month || "não informado"} · revisão {workspace.revision}. As escolhas são apenas para este relatório.</p>
      {!hasRoster && <p role="status" className={styles.muted}>Sem grade calculada: estão disponíveis apenas jornadas e variantes.</p>}
      {!month && <p role="alert" className={styles.errorText}>Este planejamento não informa o mês visível. Atualize o planejamento antes de gerar o relatório.</p>}
      <fieldset disabled={disabled || stage === "processing"} className={styles.stackSmall}>
        <section className={styles.actions} aria-label="Sugestões de relatório">
          {(Object.keys(OPERATIONAL_REPORT_PRESETS) as (keyof typeof OPERATIONAL_REPORT_PRESETS)[]).map(key => <button key={key} type="button" className={buttonClass} disabled={!OPERATIONAL_REPORT_PRESETS[key].sections.some(section => available.includes(section))} onClick={() => preset(key)}>{OPERATIONAL_REPORT_PRESETS[key].label}</button>)}
        </section>
        <fieldset className={styles.stackSmall}><legend>Seções do PDF</legend>{available.map(section => <label key={section}><input type="checkbox" checked={selected.includes(section)} onChange={event => { setSections(previous => event.target.checked ? [...previous, section] : previous.filter(value => value !== section)); setStage("ready"); setMessage(""); }} /> {OPERATIONAL_REPORT_SECTION_LABELS[section]}</label>)}</fieldset>
        {sectors.length > 0 && <fieldset className={styles.stackSmall}><legend>Setores (opcional)</legend><p className={styles.muted}>Sem seleção, inclui todos os setores.</p>{sectors.map(sector => <label key={sector}><input type="checkbox" checked={selectedValidSectors.includes(sector)} onChange={event => { setSelectedSectors(previous => event.target.checked ? [...previous, sector] : previous.filter(value => value !== sector)); setStage("ready"); setMessage(""); }} /> {sector}</label>)}</fieldset>}
        {(selected.includes("presence") || selected.includes("coverage")) && <Field label={selected.includes("presence") ? "Data do mapa diário (obrigatória)" : "Data da cobertura (opcional)"}>{id => <input id={id} type="date" className={controlClass} value={date} onChange={event => { setDate(event.target.value); setStage("ready"); setMessage(""); }} />}</Field>}
        <button type="button" className={primaryClass} disabled={!month || !selected.length || (selected.includes("presence") && !date)} onClick={download}>Gerar PDF operacional</button>
      </fieldset>
      {disabled && <p className={styles.muted}>Aguarde o salvamento e a conclusão da operação atual.</p>}
      <p role={stage === "error" ? "alert" : "status"} className={stage === "error" || stage === "warning" ? styles.errorText : styles.muted}><strong>{labels[stage]}.</strong> {message}</p>
    </div>
  </details>;
}
