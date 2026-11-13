"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoExportManifestDto, TurnoExportSelection, TurnoCatalogSyncResult } from "@/lib/escalas/shift-catalog/contracts";
import { employeeReferenceShiftChoices } from "@/lib/escalas/shift-catalog/reference-choices";
import type { WorkspaceSummary } from "../use-escalas-workspace";
import { planPeriod } from "../plan-selector";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "../controls";
import styles from "../escalas.module.css";
import { catalogError, catalogPost, catalogRequest } from "./client";

type Format = "TXT1" | "TXT2";
const keyFor = (workspaceId: string, employeeId: string) => JSON.stringify([workspaceId, employeeId]);
const eligible = (person: EscalaWorkspace["input"]["employees"][number]) =>
  person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING";
const optionsFor = (workspace: EscalaWorkspace, person: EscalaWorkspace["input"]["employees"][number]) =>
  employeeReferenceShiftChoices(workspace.input, person);

export function TurnoExport({ plans, disabled }: { plans: WorkspaceSummary[]; disabled: boolean }) {
  const [period, setPeriod] = useState(() => plans[0] ? planPeriod(plans[0]).key : "");
  const groups = useMemo(() => {
    const map = new Map<string, WorkspaceSummary[]>();
    for (const plan of plans) {
      const item = planPeriod(plan);
      if (item.key !== period) continue;
      const group = map.get(item.branch) ?? [];
      group.push(plan); map.set(item.branch, group);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true })).map(([branch, items]) => ({
      branch, plans: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision || a.id.localeCompare(b.id)),
    }));
  }, [plans, period]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<EscalaWorkspace[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [manifest, setManifest] = useState<TurnoExportManifestDto | null>(null);
  const [acceptOmissions, setAcceptOmissions] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Format, string>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const filesRef = useRef(files); filesRef.current = files;
  useEffect(() => () => { Object.values(filesRef.current).forEach(url => { if (url) URL.revokeObjectURL(url); }); }, []);
  useEffect(() => {
    setSelected(previous => {
      const next: Record<string, string> = {};
      for (const group of groups) {
        const old = previous[group.branch];
        next[group.branch] = old === "" ? "" : group.plans.some(plan => plan.id === old) ? old : group.plans[0].id;
      }
      return next;
    });
    setLoaded([]); setChoices({}); setManifest(null); setAcceptOmissions(false); setConfirmSync(false);
    setFiles(previous => { Object.values(previous).forEach(url => { if (url) URL.revokeObjectURL(url); }); return {}; });
  }, [groups]);
  function clearResult() {
    setManifest(null); setAcceptOmissions(false); setConfirmSync(false); setError(""); setNotice("");
    setFiles(previous => { Object.values(previous).forEach(url => { if (url) URL.revokeObjectURL(url); }); return {}; });
  }
  function changeSelection(branch: string, id: string) {
    setSelected(previous => ({ ...previous, [branch]: id }));
    setLoaded([]); setChoices({}); clearResult();
  }
  const selectedPlans = groups.flatMap(group => group.plans.filter(plan => plan.id === selected[group.branch]));
  const selectedKey = selectedPlans.map(plan => plan.id + ":" + plan.revision).join("|");
  const loadedKey = loaded.map(plan => plan.id + ":" + plan.revision).join("|");
  const current = loaded.length > 0 && selectedKey === loadedKey;
  const unresolved = loaded.flatMap(workspace => workspace.input.employees.filter(eligible).filter(person => {
    const variants = optionsFor(workspace, person);
    return variants.length > 1 && !variants.some(variant => variant.shiftId === choices[keyFor(workspace.id, person.id)]);
  }));
  async function prepareReferences() {
    if (disabled || busy || running.current || selectedPlans.length === 0 || selectedPlans.length > 50) return;
    running.current = true; setBusy("Consultando planejamentos…"); setError(""); setLoaded([]); setChoices({}); clearResult();
    try {
      const next: EscalaWorkspace[] = [];
      for (const summary of selectedPlans) {
        const value = await catalogRequest<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(summary.id));
        if (value.id !== summary.id || value.revision !== summary.revision) throw new Error("Uma revisão foi alterada. Atualize a página e selecione os planejamentos novamente.");
        next.push(value);
      }
      setLoaded(next);
    } catch (cause) { setError(catalogError(cause)); }
    finally { running.current = false; setBusy(""); }
  }
  function chosenShift(workspace: EscalaWorkspace, person: EscalaWorkspace["input"]["employees"][number]) {
    const variants = optionsFor(workspace, person);
    return variants.length === 1 ? variants[0].shiftId : choices[keyFor(workspace.id, person.id)] ?? "";
  }
  async function createManifest() {
    if (disabled || busy || running.current || !current || unresolved.length) return;
    running.current = true; setBusy("Preparando conferência…"); clearResult();
    try {
      const selections: TurnoExportSelection[] = loaded.map(workspace => ({
        workspaceId: workspace.id, revision: workspace.revision,
        employees: workspace.input.employees.filter(eligible).flatMap(person => {
          const localShiftId = chosenShift(workspace, person);
          return localShiftId ? [{ employeeId: person.id, localShiftId }] : [];
        }),
      }));
      setManifest(await catalogPost<TurnoExportManifestDto>("/api/escalas/turnos/export/manifest", {
        year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)), selections,
      }));
    } catch (cause) { setError(catalogError(cause)); }
    finally { running.current = false; setBusy(""); }
  }
  async function syncMissing() {
    if (disabled || busy || running.current || !manifest || !confirmSync) return;
    const byWorkspace = new Map<string, Set<string>>();
    for (const omission of manifest.omissions.filter(item => item.reason === "CATALOG_REQUIRED")) {
      const workspace = loaded.find(item => item.id === omission.workspaceId);
      const person = workspace?.input.employees.find(item => item.id === omission.employeeId);
      if (!workspace || !person) { setError("A conferência contém uma referência indisponível. Gere uma nova conferência."); return; }
      const shift = chosenShift(workspace, person);
      if (!shift) { setError("Uma referência necessária não foi selecionada. Gere uma nova conferência."); return; }
      const group = byWorkspace.get(workspace.id) ?? new Set<string>(); group.add(shift); byWorkspace.set(workspace.id, group);
    }
    if (!byWorkspace.size) { setError("Nenhuma referência selecionada pode ser cadastrada. Confira as escolhas e gere a conferência novamente."); return; }
    const sources = [...byWorkspace].map(([workspaceId, shifts]) => ({
      workspaceId, expectedRevision: loaded.find(item => item.id === workspaceId)?.revision ?? 0, localShiftIds: [...shifts],
    }));
    if (sources.length > 50 || sources.some(source => !source.workspaceId || source.workspaceId.length > 100 || !Number.isInteger(source.expectedRevision) || source.expectedRevision < 1 || source.expectedRevision > 2_000_000_000 || source.localShiftIds.length > 120 || source.localShiftIds.some(id => !id || id.length > 100))) {
      setError("A seleção excede os limites de cadastro: até 50 planejamentos e 120 turnos por planejamento. Ajuste a seleção antes de cadastrar; nenhum turno foi cadastrado."); return;
    }
    running.current = true; setBusy("Cadastrando referências…"); setError("");
    try {
      await catalogPost<TurnoCatalogSyncResult>("/api/escalas/turnos", { action: "SYNC", confirm: true, sources });
      clearResult();
      setNotice("Referências cadastradas. Gere uma nova conferência antes de baixar.");
    } catch (cause) {
      clearResult();
      setError(catalogError(cause));
    } finally { running.current = false; setBusy(""); setConfirmSync(false); }
  }
  async function prepareFile(format: Format) {
    if (disabled || busy || running.current || !manifest || (manifest.omissions.length > 0 && !acceptOmissions)) return;
    running.current = true; setBusy("Preparando " + format + "…"); setError("");
    try {
      const query = new URLSearchParams({ manifestId: manifest.manifestId, format, acceptOmissions: String(acceptOmissions) });
      const response = await fetch("/api/escalas/turnos/export?" + query, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
        const body: unknown = await response.json().catch(() => null);
        const item = body && typeof body === "object" && "error" in body ? body.error : null;
        throw new Error(item && typeof item === "object" && "message" in item && typeof item.message === "string" ? item.message : "Não foi possível preparar o arquivo. Gere uma nova conferência.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setFiles(previous => { if (previous[format]) URL.revokeObjectURL(previous[format]); return { ...previous, [format]: url }; });
    } catch (cause) { setError(catalogError(cause)); }
    finally { running.current = false; setBusy(""); }
  }
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Exportar turnos TXT da empresa</summary>
    <p className={styles.muted}>Escolha o mês e um planejamento por filial. A referência escolhida para o arquivo não modifica a grade.</p>
    <Field label="Mês dos arquivos TXT">{id => <input id={id} className={controlClass} type="month" min="2026-01" value={period} disabled={disabled || Boolean(busy)} onChange={event => { setPeriod(event.target.value); clearResult(); }} />}</Field>
    {groups.length === 0 && <p>Nenhum planejamento disponível para este mês.</p>}
    <ul className={styles.stackSmall}>{groups.map(group => <li key={group.branch}>
      <label className={styles.check}><input type="checkbox" checked={Boolean(selected[group.branch])} disabled={disabled || Boolean(busy)} onChange={event => changeSelection(group.branch, event.target.checked ? group.plans[0].id : "")} /> Filial {group.branch} · {group.plans[0].input.branchName}</label>
      {selected[group.branch] && group.plans.length > 1 && <Field label={"Planejamento da filial " + group.branch}>{id => <select id={id} className={controlClass} value={selected[group.branch]} disabled={disabled || Boolean(busy)} onChange={event => changeSelection(group.branch, event.target.value)}>{group.plans.map(plan => <option key={plan.id} value={plan.id}>Revisão {plan.revision} · {plan.status === "PUBLISHED" ? "publicada" : "rascunho"} · {plan.updatedAt}</option>)}</select>}</Field>}
    </li>)}</ul>
    {selectedPlans.length > 50 && <p role="alert">Selecione até 50 filiais por conferência.</p>}
    <button type="button" className={buttonClass} disabled={disabled || Boolean(busy) || !period || selectedPlans.length === 0 || selectedPlans.length > 50} onClick={() => void prepareReferences()}>Conferir referências selecionadas</button>
    {current && <div className={styles.stackSmall}>
      <p>Confira as pessoas e escolha uma referência quando houver mais de uma opção.</p>
      {loaded.map(workspace => <details key={workspace.id}><summary>Filial {workspace.input.branchCode} · revisão {workspace.revision}</summary><ul>{workspace.input.employees.map(person => {
        const variants = optionsFor(workspace, person);
        return <li key={person.id} className="py-1"><span>{person.registration} · {person.name}: </span>{!eligible(person) ? person.scheduleMode === "UNTIMED" ? "sem horário fixo; será omitido" : "horário não informado; será omitido" : variants.length === 0 ? "sem turno informado; será omitido" : variants.length === 1 ? variants[0].label : <Field label={"Referência de " + person.registration}>{id => <select id={id} className={controlClass} value={choices[keyFor(workspace.id, person.id)] ?? ""} disabled={disabled || Boolean(busy)} onChange={event => { setChoices(previous => ({ ...previous, [keyFor(workspace.id, person.id)]: event.target.value })); clearResult(); }}><option value="">Escolha uma referência</option>{variants.map(variant => <option key={variant.shiftId} value={variant.shiftId}>{variant.label}</option>)}</select>}</Field>}</li>;
      })}</ul></details>)}
      {unresolved.length > 0 && <p>Escolha uma referência para cada pessoa com mais de um turno.</p>}
      <button type="button" className={primaryClass} disabled={disabled || Boolean(busy) || unresolved.length > 0} onClick={() => void createManifest()}>Gerar conferência dos arquivos</button>
    </div>}
    {manifest && <div className={styles.stackSmall}>
      <p role="status">{manifest.rowCount} registro(s) incluído(s); {manifest.omissions.length} omissão(ões). Confira antes de baixar.</p>
      {manifest.omissions.length > 0 && <details><summary>Consultar omissões</summary><ul>{manifest.omissions.map(item => <li key={item.workspaceId + ":" + item.employeeId + ":" + item.reason}>{item.registration} · {({ NO_REFERENCE: "sem referência selecionada", MISSING: "horário não informado", UNTIMED: "sem horário fixo", CATALOG_REQUIRED: "turno ainda não cadastrado", ZERO_MARKINGS: "marcações zeradas", PARTIAL: "horário incompleto", OVERNIGHT: "horário ultrapassa o dia", PAID_BREAK: "pausa remunerada", TOO_MANY_PERIODS: "mais períodos que o formato aceita", DUPLICATE_REGISTRATION: "matrícula duplicada" } as const)[item.reason]}</li>)}</ul></details>}
      {manifest.omissions.some(item => item.reason === "CATALOG_REQUIRED") && <div className={styles.stackSmall}><label className={styles.check}><input type="checkbox" checked={confirmSync} disabled={disabled || Boolean(busy)} onChange={event => setConfirmSync(event.target.checked)} /> Confirmo o cadastro das referências sem código no catálogo da empresa.</label><button type="button" className={buttonClass} disabled={disabled || Boolean(busy) || !confirmSync} onClick={() => void syncMissing()}>Cadastrar turnos necessários</button></div>}
      {manifest.omissions.length > 0 && <label className={styles.check}><input type="checkbox" checked={acceptOmissions} disabled={disabled || Boolean(busy)} onChange={event => setAcceptOmissions(event.target.checked)} /> Confirmo a exportação com as omissões listadas.</label>}
      <div className={styles.actions}>{(["TXT1", "TXT2"] as const).map(format => <div key={format}><button type="button" className={buttonClass} disabled={disabled || Boolean(busy) || manifest.rowCount === 0 || (manifest.omissions.length > 0 && !acceptOmissions)} onClick={() => void prepareFile(format)}>Preparar {format}</button>{files[format] && (!manifest.omissions.length || acceptOmissions) && <a className={buttonClass} href={files[format]} download={"turnos-" + period + "-" + format + ".txt"}>Baixar {format}</a>}</div>)}</div>
      <p className={styles.muted}>TXT1 contém matrícula e quatro marcações. TXT2 contém código, nome e quatro marcações. Ambos usam esta mesma conferência.</p>
    </div>}
    {busy && <p role="status">{busy}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {disabled && <p className={styles.muted}>Aguarde o salvamento ou processamento da edição aberta.</p>}
  </details>;
}
