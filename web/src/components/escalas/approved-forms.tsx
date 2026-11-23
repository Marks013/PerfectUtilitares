"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalaApprovedPolicyView, EscalaWorkspaceAccessMetadata } from "@/lib/escalas/access-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { useEscalaClientAccess } from "./access-context";
import { approvedPoliciesFor } from "./operational-client";
import { buttonClass, controlClass, Field, primaryClass } from "./controls";
import { monthPeriod } from "./workspace-model";
import { planningMonth } from "@/lib/escalas/planning-month";
import styles from "./escalas.module.css";

export function useApprovedPolicies(branchCode: string, startDate: string, endDate: string, enabled = true, revision = 0) {
  const [retry, setRetry] = useState(0);
  const key = `${branchCode}:${startDate}:${endDate}:${revision}:${retry}`;
  const [state, setState] = useState<{ key: string; policies: EscalaApprovedPolicyView[]; loading: boolean; error: string }>({ key: "", policies: [], loading: enabled, error: "" });
  useEffect(() => {
    if (!enabled || !branchCode || !startDate || !endDate) return;
    const abort = new AbortController();
    setState({ key, policies: [], loading: true, error: "" });
    void approvedPoliciesFor({ branchCode, startDate, endDate }, abort.signal)
      .then(policies => { if (!abort.signal.aborted) setState({ key, policies, loading: false, error: "" }); })
      .catch(cause => { if (!abort.signal.aborted) setState({ key, policies: [], loading: false, error: cause instanceof Error ? cause.message : "Não foi possível consultar as configurações. Tente novamente." }); });
    return () => abort.abort();
  }, [branchCode, startDate, endDate, enabled, key]);
  return { policies: state.key === key ? state.policies : [], loading: enabled && (state.key !== key || state.loading), error: state.key === key ? state.error : "", refresh: () => setRetry(value => value + 1) };
}

export function CreateApprovedPlan({ disabled, create }: { disabled: boolean; create: (id: string) => void }) {
  const access = useEscalaClientAccess();
  const branches = access?.branches.filter(branch => branch.capabilities.includes("workspace.create") && branch.capabilities.includes("workspace.read")) ?? [];
  const [branchCode, setBranch] = useState(branches.length === 1 ? branches[0].code : "");
  const [month, setMonth] = useState(planningMonth);
  const [selected, setSelected] = useState("");
  let period = { startDate: "", endDate: "" };
  try { if (month) period = monthPeriod(month); } catch { /* Invalid dates stay outside the request. */ }
  const policies = useApprovedPolicies(branchCode, period.startDate, period.endDate, Boolean(branchCode && month));
  const selection = policies.policies.find(policy => policy.id === selected) ?? policies.policies[0];
  return <details className={styles.disclosure}>
    <summary className={styles.disclosureTrigger}>Criar planejamento</summary>
    <form className={styles.stackSmall} onSubmit={event => { event.preventDefault(); if (!disabled && selection) create(selection.id); }}>
      <p className={styles.muted}>Escolha a filial e o mês. O planejamento usa as regras aprovadas para o período e a equipe da última importação confirmada da filial. Se ainda não houver importação confirmada, usa a equipe da configuração aprovada.</p>
      <fieldset disabled={disabled} className={styles.formGrid}>
        <Field label="Filial autorizada">{id => <select id={id} required className={controlClass} value={branchCode} onChange={event => { setBranch(event.target.value); setSelected(""); }}><option value="">Escolha a filial</option>{branches.map(branch => <option key={branch.code} value={branch.code}>{branch.code} · {branch.label}</option>)}</select>}</Field>
        <Field label="Mês do novo planejamento">{id => <input id={id} type="month" required min="2000-02" max="2099-11" className={controlClass} value={month} onChange={event => { setMonth(event.target.value); setSelected(""); }} />}</Field>
        <Field label="Configuração aprovada">{id => <select id={id} required className={controlClass} disabled={policies.loading || !policies.policies.length} value={selection?.id ?? ""} onChange={event => setSelected(event.target.value)}>{!selection && <option value="">Configuração indisponível</option>}{policies.policies.map(policy => <option key={policy.id} value={policy.id}>Versão {policy.version} · aprovada em {new Date(policy.approvedAt).toLocaleDateString("pt-BR")}</option>)}</select>}</Field>
      </fieldset>
      {policies.loading && <p role="status">Consultando configurações aprovadas…</p>}
      {policies.error && <p role="alert" className={styles.errorText}>{policies.error}</p>}
      {!policies.loading && !policies.error && branchCode && !policies.policies.length && <p role="status">Não há configuração aprovada para esta filial e este período. Peça ao administrador para aprovar a versão; depois consulte novamente.</p>}
      <div className={styles.actions}><button type="submit" className={primaryClass} disabled={disabled || !selection || policies.loading}>Criar com esta equipe</button><button type="button" className={buttonClass} disabled={disabled || policies.loading || !branchCode} onClick={policies.refresh}>Consultar novamente</button></div>
    </form>
  </details>;
}

export function ApprovedEmployeeForm({ workspace, disabled, add }: { workspace: EscalaWorkspace; disabled: boolean; add: (modelId: string, name: string, registration: string) => Promise<boolean> }) {
  const approvalId = (workspace as EscalaWorkspace & Partial<EscalaWorkspaceAccessMetadata>).approvedPolicyVersionId;
  const input = workspace.input;
  const policies = useApprovedPolicies(input.branchCode, input.startDate, input.endDate, Boolean(approvalId), workspace.revision);
  const approval = policies.policies.find(policy => policy.id === approvalId);
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submittingRef = useRef(false);
  const model = approval?.regimeModels.find(item => item.id === modelId);
  const duplicate = Boolean(registration.trim() && input.employees.some(person => person.registration === registration.trim()));
  return <details className={styles.disclosure}>
    <summary className={styles.disclosureTrigger}>Adicionar colaborador por modelo aprovado</summary>
    <form className={styles.stackSmall} onSubmit={async event => {
      event.preventDefault();
      if (disabled || submittingRef.current || !model || !name.trim() || !registration.trim() || duplicate) return;
      submittingRef.current = true; setSubmitting(true); setSubmitError("");
      try {
        if (await add(model.id, name.trim(), registration.trim())) { setName(""); setRegistration(""); setModelId(""); }
        else setSubmitError("O cadastro não foi confirmado. O preenchimento foi mantido; confira a orientação do planejamento antes de repetir.");
      } catch { setSubmitError("Não foi possível confirmar o cadastro. O preenchimento foi mantido; confira a conexão e tente novamente."); }
      finally { submittingRef.current = false; setSubmitting(false); }
    }}>
      <p className={styles.muted}>O cadastro usa a jornada e as regras do modelo aprovado. A próxima importação completa da equipe pode atualizar ou retirar este cadastro do planejamento.</p>
      <fieldset disabled={disabled || submitting || policies.loading || !approval} className={styles.formGrid}>
        <Field label="Nome completo">{id => <input id={id} className={controlClass} value={name} required maxLength={160} onChange={event => setName(event.target.value)} />}</Field>
        <Field label="Matrícula" hint="Mantenha os zeros do cadastro original." error={duplicate ? "Esta matrícula já está cadastrada na filial. Confira o cadastro existente." : undefined}>{id => <input id={id} className={controlClass} value={registration} required maxLength={50} onChange={event => setRegistration(event.target.value)} />}</Field>
        <Field label="Modelo de jornada aprovado">{id => <select id={id} required className={controlClass} value={model?.id ?? ""} onChange={event => setModelId(event.target.value)}><option value="">Escolha o modelo</option>{approval?.regimeModels.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</Field>
      </fieldset>
      {policies.loading && <p role="status">Consultando modelos aprovados…</p>}
      {policies.error && <p role="alert" className={styles.errorText}>{policies.error}</p>}
      {!policies.loading && !policies.error && !approval && <p className={styles.muted}>Este planejamento precisa estar vinculado a uma configuração aprovada e vigente. Peça ao administrador para conferir a liberação.</p>}
      {approval && !approval.regimeModels.length && <p className={styles.muted}>O administrador ainda não liberou modelos de cadastro nesta versão.</p>}
      {submitError && <p role="alert" className={styles.errorText}>{submitError}</p>}
      <div className={styles.actions}><button type="submit" className={primaryClass} disabled={disabled || submitting || !model || !name.trim() || !registration.trim() || duplicate}>{submitting ? "Confirmando cadastro…" : "Cadastrar e salvar colaborador"}</button><button type="button" className={buttonClass} disabled={disabled || submitting || policies.loading || !approvalId} onClick={policies.refresh}>Consultar modelos novamente</button>{Boolean(name || registration || modelId) && <button type="button" className={buttonClass} disabled={disabled || submitting} onClick={() => { setName(""); setRegistration(""); setModelId(""); setSubmitError(""); }}>Descartar preenchimento do novo cadastro</button>}</div>
    </form>
  </details>;
}
