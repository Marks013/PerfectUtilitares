"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoCatalogEntryDto, TurnoCatalogPageDto, TurnoCatalogSyncResult } from "@/lib/escalas/shift-catalog/contracts";
import type { TurnoFlowFilters, TurnoSelectionManifestDto } from "@/lib/escalas/shift-catalog/flow-contracts";
import type { WorkspaceSummary } from "../use-escalas-workspace";
import { planPeriod } from "../plan-selector";
import { useCatalogTask } from "./use-catalog-task";
import { catalogBytes, catalogPost, catalogRequest } from "./client";
import { chosenReference, confirmManifest, emptyFilters, expectedBytes, filteredCatalog, filterPeople, flowPeople, intersectSelection, selectionRequest, validCatalogEntry } from "./flow-model";

export type Format = "TXT1" | "TXT2";
export const EXPORT_PAGE_SIZE = 20;

export function useExportFlow(plans: WorkspaceSummary[], disabled: boolean, canDefine: boolean) {
  const task = useCatalogTask();
  const cancelTask = task.invalidate, setError = task.setError;
  const [mode, setMode] = useState<"CATALOG" | "EMPLOYEES">("CATALOG"), [scope, setScope] = useState<"ALL" | "USED">("ALL");
  const [period, setPeriod] = useState(() => plans[0] ? planPeriod(plans[0]).key : new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7));
  const periodRef = useRef<HTMLInputElement>(null);
  const periodError = /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && Number(period.slice(0, 4)) >= 2026 ? "" : "Informe um mês válido a partir de janeiro de 2026.";
  const [sources, setSources] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<EscalaWorkspace[]>([]), [entries, setEntries] = useState<TurnoCatalogEntryDto[]>([]), [complete, setComplete] = useState(false);
  const [filters, setFilters] = useState<TurnoFlowFilters>(emptyFilters), [selected, setSelected] = useState<string[]>([]), [choices, setChoices] = useState<Record<string, string>>({}), [page, setPage] = useState(0);
  const [manifest, setManifest] = useState<TurnoSelectionManifestDto | null>(null), [acceptOmissions, setAcceptOmissions] = useState(false), [confirmSync, setConfirmSync] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Format, string>>>({}), [notice, setNotice] = useState("");
  const urls = useRef<Partial<Record<Format, string>>>({});
  const relational = mode === "EMPLOYEES" || scope === "USED";
  const summaries = plans.filter(plan => planPeriod(plan).key === period);
  const groups = [...new Set(summaries.map(plan => planPeriod(plan).branch))].sort();
  const selectedPlans = summaries.filter(plan => sources[planPeriod(plan).branch] === plan.id);
  const sourceKey = JSON.stringify(plans.map(plan => [plan.id, plan.revision, planPeriod(plan).branch, planPeriod(plan).key]).sort());
  const people = flowPeople(loaded, entries), matchingPeople = filterPeople(people, filters), matchingEntries = filteredCatalog(entries, people, filters, scope);
  const keys = mode === "CATALOG" ? matchingEntries.map(entry => String(entry.code)) : matchingPeople.map(person => person.key);
  const pages = Math.max(1, Math.ceil(keys.length / EXPORT_PAGE_SIZE)), currentPage = Math.min(page, pages - 1), visibleKeys = keys.slice(currentPage * EXPORT_PAGE_SIZE, (currentPage + 1) * EXPORT_PAGE_SIZE);
  const releaseFiles = useCallback(() => { Object.values(urls.current).forEach(url => { if (url) URL.revokeObjectURL(url); }); urls.current = {}; setFiles({}); }, []);
  const invalidate = useCallback(() => { cancelTask(); setManifest(null); setAcceptOmissions(false); setConfirmSync(false); releaseFiles(); }, [cancelTask, releaseFiles]);
  const resetData = useCallback(() => { invalidate(); setComplete(false); setLoaded([]); setEntries([]); setSelected([]); setChoices({}); setFilters(emptyFilters()); setPage(0); setNotice(""); }, [invalidate]);
  const previousSources = useRef(sourceKey);
  useEffect(() => { if (previousSources.current !== sourceKey) { previousSources.current = sourceKey; resetData(); setSources({}); } }, [sourceKey, resetData]);
  useEffect(() => { if (disabled) invalidate(); }, [disabled, invalidate]);
  useEffect(() => () => { Object.values(urls.current).forEach(url => { if (url) URL.revokeObjectURL(url); }); }, []);
  useEffect(() => {
    if (!manifest) return;
    const timer = setTimeout(() => { invalidate(); setError("A conferência expirou. Confira a seleção novamente."); }, Math.max(0, Date.parse(manifest.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [manifest, invalidate, setError]);

  async function consult() {
    if (disabled || relational && (!selectedPlans.length || selectedPlans.length > 50)) return;
    if (periodError) { periodRef.current?.scrollIntoView({ block: "center" }); periodRef.current?.focus({ preventScroll: true }); return; }
    resetData();
    await task.run("Consultando catálogo e referências…", async signal => {
      const catalogue: TurnoCatalogEntryDto[] = [], cursors = new Set<string>(); let cursor = "0";
      for (;;) {
        signal.throwIfAborted();
        const result = await catalogRequest<TurnoCatalogPageDto>("/api/escalas/turnos?" + new URLSearchParams({ limit: "100", cursor }), { signal });
        if (!Array.isArray(result.entries) || result.entries.some(entry => !validCatalogEntry(entry) || entry.code <= Number(cursor)) || new Set(result.entries.map(entry => entry.code)).size !== result.entries.length) throw new Error("A lista de turnos não foi confirmada. Consulte novamente.");
        if (result.entries.some(entry => catalogue.some(known => known.code === entry.code))) throw new Error("A paginação do catálogo mudou. Consulte novamente.");
        catalogue.push(...result.entries);
        if (result.nextCursor === null) break;
        if (!/^\d+$/.test(result.nextCursor) || Number(result.nextCursor) <= Number(cursor) || cursors.has(result.nextCursor)) throw new Error("A paginação do catálogo não foi confirmada.");
        cursor = result.nextCursor; cursors.add(cursor);
      }
      const workspaces: EscalaWorkspace[] = [];
      if (relational) for (const plan of selectedPlans) {
        const value = await catalogRequest<EscalaWorkspace>("/api/escalas?id=" + encodeURIComponent(plan.id), { signal });
        if (value.id !== plan.id || value.revision !== plan.revision || planPeriod(value).branch !== planPeriod(plan).branch || planPeriod(value).key !== period) throw new Error("Uma fonte ou revisão mudou. Atualize os planejamentos e confira novamente.");
        workspaces.push(value);
      }
      return { catalogue, workspaces };
    }, result => { setEntries(result.catalogue); setLoaded(result.workspaces); setComplete(true); setNotice("Consulta completa. Marque os itens que entrarão no arquivo."); });
  }

  function changeFilters(next: TurnoFlowFilters) {
    invalidate(); setFilters(next); setPage(0);
    const nextKeys = mode === "CATALOG" ? filteredCatalog(entries, people, next, scope).map(entry => String(entry.code)) : filterPeople(people, next).map(person => person.key);
    const retained = intersectSelection(selected, nextKeys); setSelected(retained);
    const filtered = filterPeople(people, next);
    setChoices(previous => Object.fromEntries(Object.entries(previous).filter(([key, id]) => filtered.some(person => person.key === key && person.references.some(ref => ref.shiftId === id && (!next.catalogCodes.length || ref.code !== null && next.catalogCodes.includes(ref.code)))))));
    setNotice(selected.length > retained.length ? `${selected.length - retained.length} item(ns) retirado(s) da seleção por incompatibilidade com os filtros. Confira novamente.` : "Filtros alterados. Confira a seleção novamente.");
  }
  function changeSelected(next: string[]) { invalidate(); setSelected(next); setNotice(""); }
  async function preview() {
    if (disabled || !complete || !selected.length || manifest) return;
    invalidate();
    try {
      const request = selectionRequest(mode, scope, period, loaded, entries, filters, selected, choices);
      await task.run("Conferindo seleção e revisões…", async signal => confirmManifest(await catalogPost<TurnoSelectionManifestDto>("/api/escalas/turnos/export/manifest", request, signal), request, entries), value => { setManifest(value); if (value.blockers.length) task.reportError(value.blockers.map(blocker => blocker.message).join(" "), true); }, { focusOnError: true });
    } catch (cause) { task.reportError(cause instanceof Error ? cause.message : "Confira a seleção.", true); }
  }
  async function prepareFile(format: Format) {
    if (disabled || !manifest || manifest.blockers.length || manifest.omissions.length && !acceptOmissions) return;
    if (Date.parse(manifest.expiresAt) <= Date.now()) { invalidate(); task.reportError("A conferência expirou. Confira novamente.", true); return; }
    const expected = expectedBytes(manifest, format);
    const old = urls.current[format]; if (old) URL.revokeObjectURL(old);
    const remaining = { ...urls.current }; delete remaining[format]; urls.current = remaining; setFiles(remaining);
    await task.run("Preparando arquivo conferido…", signal => catalogBytes("/api/escalas/turnos/export?" + new URLSearchParams({ manifestId: manifest.manifestId, format, acceptOmissions: String(acceptOmissions) }), signal), bytes => {
      if (!expected.length || bytes.length !== expected.length || bytes.some((value, i) => value !== expected[i])) throw new Error("O arquivo recebido difere das linhas conferidas. Nenhum download foi liberado; confira novamente.");
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "text/plain;charset=utf-8" }));
      urls.current = { ...urls.current, [format]: url }; setFiles(urls.current);
    }, { focusOnError: true });
  }
  async function syncMissing() {
    if (!canDefine || !confirmSync || !manifest || manifest.mode !== "EMPLOYEES") return;
    const bySource = new Map<string, Set<string>>();
    for (const omission of manifest.omissions.filter(item => item.reason === "CATALOG_REQUIRED")) {
      const person = people.find(row => row.workspaceId === omission.workspaceId && row.employeeId === omission.employeeId);
      const shift = person && chosenReference(person, choices, filters);
      if (!person || !shift) { task.reportError("Uma referência está indisponível. Confira a seleção antes de cadastrar.", true); return; }
      const group = bySource.get(person.workspaceId) ?? new Set<string>(); group.add(shift); bySource.set(person.workspaceId, group);
    }
    const payload = [...bySource].flatMap(([workspaceId, ids]) => { const source = loaded.find(item => item.id === workspaceId); return source ? [{ workspaceId, expectedRevision: source.revision, localShiftIds: [...ids] }] : []; });
    if (!payload.length || payload.some(source => source.localShiftIds.length > 120)) { task.reportError("Selecione referências válidas, até 120 por fonte, antes de cadastrar.", true); return; }
    const failureMessage = "O cadastro não foi confirmado. Consulte o catálogo antes de repetir; uma gravação já aceita não é desfeita pelo cancelamento.";
    let failed = false;
    const confirmed = await task.run("Cadastrando referências confirmadas…", signal => catalogPost<TurnoCatalogSyncResult>("/api/escalas/turnos", { action: "SYNC", confirm: true, sources: payload }, signal), result => { resetData(); setNotice(`${result.createdCount} referência(s) cadastrada(s); ${result.unchangedCount} já existente(s). Consulte e confira novamente.`); }, { focusOnError: true, onError: () => { failed = true; resetData(); return failureMessage; } });
    if (!confirmed && !failed) { resetData(); task.setError(failureMessage); }
  }
  return { task, mode, scope, period, periodRef, periodError, sources, loaded, entries, complete, filters, selected, choices, manifest, acceptOmissions, confirmSync, files, notice,
    relational, summaries, groups, selectedPlans, people, matchingPeople, matchingEntries, keys, pages, currentPage, visibleKeys,
    consult, preview, prepareFile, syncMissing, changeFilters, changeSelected, setPage, setConfirmSync,
    setMode: (value: "CATALOG" | "EMPLOYEES") => { resetData(); setMode(value); },
    setScope: (value: "ALL" | "USED") => { resetData(); setScope(value); },
    setPeriod: (value: string) => { resetData(); setSources({}); setPeriod(value); },
    setSource: (branch: string, id: string) => { resetData(); setSources(previous => ({ ...previous, [branch]: id })); },
    setChoice: (key: string, id: string) => { invalidate(); setChoices(previous => ({ ...previous, [key]: id })); },
    setAcceptOmissions: (value: boolean) => { task.invalidate(); releaseFiles(); setAcceptOmissions(value); },
    unavailableChoices: mode === "EMPLOYEES" && matchingPeople.some(person => selected.includes(person.key) && person.references.length > 1 && !chosenReference(person, choices, filters)),
  };
}

export type ExportFlow = ReturnType<typeof useExportFlow>;
