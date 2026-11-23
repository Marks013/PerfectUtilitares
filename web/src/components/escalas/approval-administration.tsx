"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalaApprovedPolicyView, EscalaApprovePolicyCommand } from "@/lib/escalas/access-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { useEscalaClientAccess } from "./access-context";
import { useApprovedPolicies } from "./approved-forms";
import { accessRequest } from "./operational-client";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";

export function ApprovalAdministration({ workspace, disabled, prepare, rebase }: {
  workspace: EscalaWorkspace; disabled: boolean; prepare: () => Promise<EscalaWorkspace | null>; rebase: (id: string) => void;
}) {
  const access = useEscalaClientAccess();
  const administrative = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const input = workspace.input;
  const policies = useApprovedPolicies(input.branchCode, input.startDate, input.endDate, administrative);
  const [models, setModels] = useState<Record<string, string>>({});
  const [includeProtectedDays, setIncludeProtectedDays] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const selectedPolicy = policies.policies.find(policy => policy.id === selected);
  if (!administrative) return null;
  async function approve() {
    if (disabled || running.current || !reviewed) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    const abort = new AbortController(); active.current = abort;
    try {
      const saved = await prepare();
      if (!saved || abort.signal.aborted) return;
      if (saved.id !== workspace.id || saved.revision !== workspace.revision) throw new Error("A revisão mudou durante a conferência. Confira a revisão salva e marque a conferência novamente.");
      const regimeModelSelections = saved.input.employees.filter(person => Boolean(models[person.id]?.trim())).map(person => ({ id: crypto.randomUUID(), employeeId: person.id, label: models[person.id].trim() }));
      const command: EscalaApprovePolicyCommand = { action: "APPROVE", input: saved.input, origin: { workspaceId: saved.id, revision: saved.revision }, regimeModelSelections,
        selectedSeedAssignments: includeProtectedDays ? saved.input.assignments.flatMap(day => day.kind === "ABSENCE" || day.kind === "HOLIDAY" ? [{ employeeId: day.employeeId, date: day.date, kind: day.kind }] : []) : [] };
      const result = await accessRequest<{ policy: EscalaApprovedPolicyView }>("/api/escalas/approved-policy", command, abort.signal);
      if (abort.signal.aborted) return;
      if (!result.policy?.id) throw new Error("O servidor não confirmou a versão aprovada. Consulte as versões antes de repetir.");
      setSelected(result.policy.id); setReviewed(false); policies.refresh();
      setNotice("Configuração aprovada. Para este planejamento usar a nova versão, confira e vincule-a abaixo. A aprovação não aplicou uma proposta à grade.");
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível aprovar."); }
    finally { if (active.current === abort && !abort.signal.aborted) { running.current = false; setBusy(false); } }
  }
  async function revoke() {
    if (disabled || running.current || !selectedPolicy) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    const abort = new AbortController(); active.current = abort;
    try {
      await accessRequest("/api/escalas/approved-policy", { action: "REVOKE", id: selectedPolicy.id }, abort.signal);
      if (!abort.signal.aborted) { setSelected(""); policies.refresh(); setNotice("Versão revogada. O histórico foi preservado; novos usos operacionais dessa versão ficam bloqueados."); }
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível revogar."); }
    finally { if (active.current === abort && !abort.signal.aborted) { running.current = false; setBusy(false); } }
  }
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Aprovar configuração e modelos para a filial</summary>
    <p className={styles.muted}>Filial {input.branchCode} · {input.visibleMonth ?? input.startDate} · revisão {workspace.revision}. A filial poderá trabalhar com os parâmetros de jornada desta revisão. O sistema registra a conta administrativa que libera o uso. A conferência formal e o nome de quem a realizou são opcionais para esta liberação.</p>
    <fieldset disabled={disabled || busy} className={styles.stackSmall}>
      <p>Escolha os cadastros que servirão de modelo. Cada novo colaborador herda o regime do exemplar; não herda seu histórico pessoal.</p>
      {input.employees.map(person => <div key={person.id} className={styles.stackSmall}>
        <Check label={`Liberar modelo a partir de ${person.name} · ${person.registration}`} checked={person.id in models} onChange={value => setModels(previous => { const next = { ...previous }; if (value) next[person.id] = `${person.sector} · ${person.role}`; else delete next[person.id]; setReviewed(false); return next; })} />
        {person.id in models && <Field label={`Nome do modelo de ${person.name}`}>{id => <input id={id} required maxLength={120} className={controlClass} value={models[person.id]} onChange={event => { setModels(previous => ({ ...previous, [person.id]: event.target.value })); setReviewed(false); }} />}</Field>}
      </div>)}
      <Check label="Incluir os afastamentos e feriados já registrados como dados iniciais aprovados" checked={includeProtectedDays} onChange={value => { setIncludeProtectedDays(value); setReviewed(false); }} />
      <Check label="Autorizo esta filial a usar a configuração, os modelos e os dados iniciais desta revisão" checked={reviewed} onChange={setReviewed} />
      <button type="button" className={primaryClass} disabled={!reviewed || Object.keys(models).length === 0 || Object.values(models).some(label => !label.trim())} onClick={() => void approve()}>Liberar esta configuração para a filial</button>
      <Field label="Versão aprovada deste período">{id => <select id={id} className={controlClass} value={selectedPolicy?.id ?? ""} onChange={event => setSelected(event.target.value)}><option value="">Escolha a versão</option>{policies.policies.map(policy => <option key={policy.id} value={policy.id}>Versão {policy.version} · {policy.regimeModels.length} modelo(s)</option>)}</select>}</Field>
      <p className={styles.muted}>Vincular cria uma nova revisão preservando o histórico. Não substitui a edição aberta pelo cadastro inicial da aprovação. Gere novamente após a vinculação.</p>
      <button type="button" className={buttonClass} disabled={!selectedPolicy} onClick={() => { if (selectedPolicy) rebase(selectedPolicy.id); }}>Vincular versão ao planejamento atual</button>
      <details><summary className={styles.disclosureTrigger}>Revogar uma versão aprovada</summary><p>Revogar bloqueia novos usos operacionais desta versão, sem apagar o histórico. Selecione a versão acima e confira o número antes de continuar.</p><button type="button" className={buttonClass} disabled={!selectedPolicy} onClick={() => void revoke()}>Revogar versão {selectedPolicy?.version ?? "selecionada"}</button></details>
    </fieldset>
    {disabled && <p className={styles.muted}>Salve as alterações e resolva a proposta pendente antes de aprovar ou vincular uma versão.</p>}
    {policies.loading && <p role="status">Consultando versões aprovadas…</p>}
    {(error || policies.error) && <p role="alert" className={styles.errorText}>{error || policies.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" className={buttonClass} disabled={busy || policies.loading} onClick={policies.refresh}>Consultar versões novamente</button>
  </details>;
}
