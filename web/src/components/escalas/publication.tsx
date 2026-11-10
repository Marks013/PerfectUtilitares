"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalaExportMode } from "@/lib/escalas/presentation";
import type { EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { responseMessage } from "./workspace-model";
import { ProcessingBar } from "./workspace-feedback";
import { isReviewedRevisionCurrent, type ReviewedRevision } from "./publication-review";
import styles from "./escalas.module.css";

type Format = "pdf" | "xlsx";
type FileState = { url: string; filename: string; workspaceId: string; revision: number; mode: EscalaExportMode; separateSectors?: boolean };
const CONTENT = { rest: "Folgas", hours: "Horários", both: "Folgas e horários" };

export function Publication({ workspace, validation, dirty, busy, outdated = false, mode, onModeChange, onPublish, onRegenerate, onPrepare, isCurrent }: {
  workspace: EscalaWorkspace; validation: EscalaValidation | null; dirty: boolean; busy: boolean; outdated?: boolean; mode?: EscalaExportMode; onModeChange?: (mode: EscalaExportMode) => void;
  onPublish: () => void; onRegenerate?: () => void; onPrepare?: () => Promise<EscalaWorkspace | null>; isCurrent?: (workspace: EscalaWorkspace) => boolean;
}) {
  const [localMode, setLocalMode] = useState<EscalaExportMode>(() => mode ?? (workspace.input.generationMode === "REST_ONLY" ? "rest" : "both"));
  const selectedMode = mode ?? localMode;
  const [separateSectors, setSeparateSectors] = useState(true);
  const [reviewed, setReviewed] = useState<ReviewedRevision | null>(null);
  const confirmed = isReviewedRevisionCurrent(reviewed, workspace, dirty, outdated);
  useEffect(() => {
    setReviewed(previous => isReviewedRevisionCurrent(previous, workspace, dirty, outdated) ? previous : null);
  }, [workspace, dirty, outdated]);
  const [exporting, setExporting] = useState<Format | null>(null);
  const [files, setFiles] = useState<Partial<Record<Format, FileState>>>({});
  const urls = useRef(new Set<string>());
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const latest = useRef({ workspace, dirty, outdated, selectedMode, separateSectors });
  latest.current = { workspace, dirty, outdated, selectedMode, separateSectors };
  useEffect(() => {
    const owned = urls.current;
    return () => { owned.forEach(url => { URL.revokeObjectURL(url); }); owned.clear(); };
  }, []);
  const blocked = busy || outdated || Boolean(exporting) || !workspace.input.assignments.length;
  const ready = workspace.canPublish && !dirty && !blocked && Boolean(validation?.readyToPublish) && workspace.status !== "PUBLISHED";
  const isDownloadCurrent = (file: FileState | undefined) => Boolean(file
    && file.workspaceId === workspace.id && file.revision === workspace.revision && file.mode === selectedMode
    && (file.separateSectors === undefined || file.separateSectors === separateSectors) && !dirty && !outdated);

  async function prepare(format: Format) {
    if (blocked || inFlight.current) return;
    inFlight.current = true; setExporting(format); setError("");
    const capturedMode = selectedMode, capturedSeparation = format === "pdf" ? separateSectors : undefined;
    try {
      const snapshot = onPrepare ? await onPrepare() : dirty ? null : workspace;
      if (!snapshot) throw new Error("O rascunho ainda não foi salvo. Use Tentar salvar e gere o arquivo após a confirmação.");
      const params = new URLSearchParams({ id: snapshot.id, revision: String(snapshot.revision), format, mode: capturedMode });
      if (capturedSeparation !== undefined) params.set("separateSectors", String(capturedSeparation));
      const response = await fetch("/api/escalas/export?" + params.toString(), { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(response.status === 401 ? "Sua sessão terminou. Digite a senha novamente; o rascunho foi preservado." : responseMessage(body));
      }
      const type = response.headers.get("content-type") ?? "";
      if (!(format === "pdf" ? type.includes("application/pdf") : type.includes("spreadsheetml"))) throw new Error("O servidor não retornou o formato solicitado. Tente gerar o arquivo novamente.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("O arquivo retornou vazio. Seus dados foram preservados; tente novamente.");
      const current = latest.current;
      if ((isCurrent ? !isCurrent(snapshot) : current.workspace.id !== snapshot.id || current.workspace.revision !== snapshot.revision || current.dirty)
        || current.outdated || current.selectedMode !== capturedMode || (capturedSeparation !== undefined && current.separateSectors !== capturedSeparation)) throw new Error("O cenário mudou enquanto o arquivo era gerado. Gere novamente para baixar a revisão atual.");
      const url = URL.createObjectURL(blob); urls.current.add(url);
      const old = files[format]; if (old) { URL.revokeObjectURL(old.url); urls.current.delete(old.url); }
      const filename = "escala-" + snapshot.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + (snapshot.input.visibleMonth ?? snapshot.input.startDate) + "-r" + snapshot.revision + "-" + capturedMode + "." + format;
      setFiles(previous => ({ ...previous, [format]: { url, filename, workspaceId: snapshot.id, revision: snapshot.revision, mode: capturedMode, separateSectors: capturedSeparation } }));
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "A geração demorou além do esperado. O rascunho foi preservado; tente novamente."); }
    finally { inFlight.current = false; setExporting(null); }
  }

  return <section className={panelClass} aria-labelledby="escala-publication-title">
    <div><h2 id="escala-publication-title" className={styles.sectionTitle}>Arquivos do planejamento</h2><p className={styles.subtitle}>Filial {workspace.input.branchCode} · {workspace.input.visibleMonth ?? workspace.input.startDate} · revisão salva {workspace.revision} · {CONTENT[selectedMode]}</p></div>
    <Field label="Conteúdo do PDF e XLSX">{id => <select id={id} className={controlClass} disabled={Boolean(exporting)} value={selectedMode} onChange={event => { const value = event.target.value as EscalaExportMode; if (onModeChange) onModeChange(value); else setLocalMode(value); }}><option value="rest">Somente escala de folgas</option><option value="hours">Somente escala de horários</option><option value="both">Folgas e horários</option></select>}</Field>
    <div className={styles.stackSmall}><Check label="Separar setores por página" checked={separateSectors} disabled={exporting === "pdf"} onChange={setSeparateSectors} />
      <p className={styles.muted}>Só no PDF. Desmarque para reunir setores em menos páginas.</p></div>
    <div className={styles.fileGrid}>{(["pdf", "xlsx"] as const).map(format => {
      const file = files[format];
      const current = file && isDownloadCurrent(file);
      return <article key={format} className={styles.fileCard} aria-label={"Arquivo " + format.toUpperCase()}><div><h3 className="font-semibold">{format.toUpperCase()}</h3><p className={styles.muted}>{exporting === format ? "Processando…" : current ? "Pronto para baixar" : file ? "Desatualizado — gere novamente" : "Ainda não gerado"}</p></div>{current && <a href={file.url} download={file.filename} className={primaryClass}>Baixar {format.toUpperCase()}</a>}<button type="button" className={current ? buttonClass : primaryClass} disabled={blocked} onClick={() => void prepare(format)}>{exporting === format ? "Gerando…" : "Gerar " + format.toUpperCase()}</button></article>;
    })}</div>
    {outdated ? <div className={styles.stackSmall}><p className="text-sm">A grade está desatualizada. Gere e aplique a proposta antes de criar os arquivos.</p>{onRegenerate && <button type="button" className={buttonClass} disabled={busy} onClick={onRegenerate}>Gerar proposta atualizada</button>}</div> : dirty && <p className="text-sm">Ao gerar o arquivo, o salvamento será confirmado primeiro. Uma falha não descarta suas edições.</p>}
    {exporting && <ProcessingBar label={"Preparando " + exporting.toUpperCase() + " da revisão correta"} />}
    <p role="status" aria-live="polite" className="sr-only">{exporting ? "Arquivo em processamento" : Object.values(files).some(isDownloadCurrent) ? "Arquivo pronto para baixar" : ""}</p>
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    <details><summary className={styles.disclosureTrigger}>Aprovação interna (opcional)</summary><p className="text-sm">O salvamento automático não publica. A aprovação exige revisão conferida e perfil autorizado.</p><Check label={"Conferi esta revisão da filial " + workspace.input.branchCode} checked={confirmed} disabled={!ready} onChange={checked => setReviewed(checked ? { workspaceId: workspace.id, revision: workspace.revision, input: workspace.input } : null)} /><button type="button" className={buttonClass} disabled={!ready || !confirmed} onClick={() => { if (ready && confirmed) onPublish(); }}>{workspace.status === "PUBLISHED" ? "Revisão já publicada" : "Publicar proposta"}</button></details>
  </section>;
}
