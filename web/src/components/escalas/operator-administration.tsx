"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalaAdministrationView, EscalaOperatorAdminHttpCommand, EscalaOperatorView } from "@/lib/escalas/access-contracts";
import { ESCALA_OPERATOR_CAPABILITIES } from "@/lib/escalas/permissions";
import { useEscalaClientAccess } from "./access-context";
import { accessRequest } from "./operational-client";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";

const capabilityLabels = {
  "workspace.read": "Consultar planejamentos", "workspace.create": "Iniciar período aprovado", "workspace.save": "Salvar alterações permitidas",
  "schedule.generate": "Gerar e recalcular propostas", "schedule.apply": "Aplicar propostas e editar dias", "employee.manage": "Cadastrar por modelo e editar dados permitidos",
  "shift.manage": "Atribuir horários já cadastrados", "export.schedule.pdf": "Baixar PDF básico", "export.schedule.xlsx": "Baixar XLSX básico",
};

export function operatorBranchGrantsForCommand(grants: EscalaOperatorView["branchGrants"]): Extract<EscalaOperatorAdminHttpCommand, { action: "REPLACE_BRANCH_GRANTS" }>["branchGrants"] {
  return grants.map(grant => ({
    branchCode: grant.branchCode,
    active: grant.active,
    capabilities: grant.capabilities.map(capability => {
      const allowed = ESCALA_OPERATOR_CAPABILITIES.find(value => value === capability);
      if (!allowed) throw new Error(`A filial ${grant.branchCode || "sem código"} contém a permissão ${capability}, que não pode ser concedida a operadores. A seleção foi preservada; confira o cadastro antes de substituir as permissões.`);
      return allowed;
    }),
  }));
}

function OperatorEditor({ operator, busy, submit, onDirty }: { operator?: EscalaOperatorView; busy: boolean; submit: (command: EscalaOperatorAdminHttpCommand) => void; onDirty: (value: boolean) => void }) {
  const [username, setUsername] = useState(operator?.username ?? "");
  const [displayName, setDisplayName] = useState(operator?.displayName ?? "");
  const [active, setActive] = useState(operator?.active ?? true);
  const [grants, setGrants] = useState<(EscalaOperatorView["branchGrants"][number] & { key: string })[]>(operator?.branchGrants.map(grant => ({ ...grant, capabilities: [...grant.capabilities], key: grant.branchCode })) ?? []);
  const branchGrants = grants.map(({ key: _key, ...grant }) => grant);
  const profileDirty = Boolean(operator && (username !== operator.username || displayName !== operator.displayName || active !== operator.active));
  const grantsDirty = Boolean(operator && JSON.stringify(branchGrants) !== JSON.stringify(operator.branchGrants));
  const pending = profileDirty || grantsDirty || !operator && Boolean(username || displayName || grants.length || !active);
  useEffect(() => { onDirty(pending); }, [onDirty, pending]);
  const [error, setError] = useState("");
  const validatedGrants = () => {
    try { return operatorBranchGrantsForCommand(branchGrants); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Confira as permissões antes de salvar."); return null; }
  };
  const version = operator && { operatorId: operator.id, expectedPermissionVersion: operator.permissionVersion };
  const validateProfile = () => {
    if (!username.trim() || !displayName.trim()) { setError("Preencha o nome de entrada e o nome de exibição."); return false; }
    if (!operator && grants.some(grant => !grant.branchCode.trim())) { setError("Informe o código de cada filial antes de cadastrar."); return false; }
    setError(""); return true;
  };
  return <div className={styles.stackSmall}>
    <form className={styles.stackSmall} onSubmit={event => {
      event.preventDefault(); if (busy || grantsDirty || !validateProfile()) return;
      if (operator && version) submit({ action: "UPDATE_OPERATOR", ...version, username: username.trim(), displayName: displayName.trim(), active });
      else { const validated = validatedGrants(); if (validated) submit({ action: "CREATE_OPERATOR", username: username.trim(), displayName: displayName.trim(), active, branchGrants: validated }); }
    }}>
      <fieldset disabled={busy || grantsDirty} className={styles.formGrid}>
        <Field label="Nome usado para entrar">{id => <input id={id} className={controlClass} required maxLength={160} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} />}</Field>
        <Field label="Nome de exibição">{id => <input id={id} className={controlClass} required maxLength={120} value={displayName} onChange={event => setDisplayName(event.target.value)} />}</Field>
        <Check label="Acesso ativo" checked={active} onChange={setActive} />
      </fieldset>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <button className={primaryClass} disabled={busy || grantsDirty} type="submit">{operator ? "Salvar nome e situação" : "Cadastrar operador e filiais"}</button>
    </form>
    <fieldset disabled={busy || profileDirty} className={styles.stackSmall}><legend>Filiais e ações liberadas</legend>
      <p className={styles.muted}>Nenhuma filial ou ação é concedida automaticamente. Criar ou alterar definições de turnos, configurar 8h/9h, importar e emitir relatórios gerenciais continuam administrativos.</p>
      {grants.map((grant, index) => <div key={grant.key} className={styles.stackSmall}>
        <Field label={`Código da filial ${index + 1}`}>{id => <input id={id} className={controlClass} required maxLength={160} value={grant.branchCode} onChange={event => setGrants(previous => previous.map((value, at) => at === index ? { ...value, branchCode: event.target.value } : value))} />}</Field>
        <Check label="Filial liberada" checked={grant.active} onChange={value => setGrants(previous => previous.map((item, at) => at === index ? { ...item, active: value } : item))} />
        <div className={styles.formGrid}>{ESCALA_OPERATOR_CAPABILITIES.map(capability => <Check key={capability} label={capabilityLabels[capability]} checked={grant.capabilities.includes(capability)} onChange={enabled => setGrants(previous => previous.map((item, at) => at === index ? { ...item, capabilities: enabled ? [...item.capabilities, capability] : item.capabilities.filter(value => value !== capability) } : item))} />)}</div>
        <button type="button" className={buttonClass} onClick={() => setGrants(previous => previous.filter((_, at) => at !== index))}>Retirar filial desta seleção</button>
      </div>)}
      {!grants.length && <p>Nenhuma filial selecionada. O operador não terá acesso a planejamentos.</p>}
      <button type="button" className={buttonClass} disabled={grants.length >= 256} onClick={() => setGrants(previous => [...previous, { key: crypto.randomUUID(), branchCode: "", active: true, capabilities: [] }])}>Adicionar filial à seleção</button>
      {operator && version && <button type="button" className={primaryClass} onClick={() => {
        if (grants.some(grant => !grant.branchCode.trim())) { setError("Informe o código de cada filial antes de salvar."); return; }
        const validated = validatedGrants();
        if (validated) submit({ action: "REPLACE_BRANCH_GRANTS", ...version, branchGrants: validated });
      }}>Salvar filiais e ações</button>}
    </fieldset>
    <p className={styles.muted}>Salvar mudanças de acesso encerra as sessões desse operador. Ele precisará entrar novamente com as permissões atualizadas.</p>
    {(profileDirty || grantsDirty) && <p role="status" className={styles.muted}>Salve primeiro {profileDirty ? "o nome e a situação" : "as filiais e ações"} antes de alterar a outra parte ou encerrar sessões. Assim as edições abertas não são descartadas.</p>}
    {operator && version && <button type="button" className={buttonClass} disabled={busy || profileDirty || grantsDirty} onClick={() => submit({ action: "REVOKE_SESSIONS", ...version })}>Encerrar sessões deste operador</button>}
  </div>;
}

function Administration() {
  const [view, setView] = useState<EscalaAdministrationView | null>(null);
  const [selected, setSelected] = useState("");
  const [editingDirty, setEditingDirty] = useState(false);
  const [editorReset, setEditorReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  async function request(command?: EscalaOperatorAdminHttpCommand) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    const abort = new AbortController(); active.current = abort;
    try {
      const result = await accessRequest<EscalaAdministrationView>("/api/escalas/access/admin", command, abort.signal);
      if (abort.signal.aborted) return;
      if (!result.policy || !Array.isArray(result.operators)) throw new Error("A lista de acessos não foi confirmada. Consulte novamente.");
      if (command?.action === "CREATE_OPERATOR") {
        const previousIds = new Set(view?.operators.map(item => item.id));
        const created = result.operators.find(item => !previousIds.has(item.id));
        if (created) setSelected(created.id);
      }
      setView(result); setNotice(command ? "Alteração confirmada. Confira a lista atualizada abaixo." : "Acessos carregados.");
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar os acessos."); }
    finally { if (active.current === abort && !abort.signal.aborted) { running.current = false; setBusy(false); } }
  }
  const operator = view?.operators.find(item => item.id === selected);
  return <details className={panelClass} onToggle={event => { if (event.currentTarget.open && !view && !busy) void request(); }}>
    <summary className={styles.disclosureTrigger}>Administrar operadores e filiais</summary>
    <p className={styles.muted}>A entrada por nome separa a navegação; não comprova identidade pessoal. Use somente nomes e filiais que você deseja liberar.</p>
    <button type="button" className={buttonClass} disabled={busy || editingDirty} onClick={() => void request()}>Consultar acessos novamente</button>
    {busy && <p role="status">Processando acessos…</p>}{error && <p role="alert" className={styles.errorText}>{error} As alterações abertas foram mantidas. Em conflito, consulte a lista antes de reenviar.</p>}{notice && <p role="status">{notice}</p>}
    {view && <>
      <p>Modo atual: <strong>{view.policy.mode === "SCOPED" ? "Operadores por filial" : "Somente administração"}</strong>.</p>
      <details><summary className={styles.disclosureTrigger}>Alterar modo de entrada</summary><p className={styles.muted}>A alteração encerra as sessões operacionais. O acesso da conta administrativa é preservado. A ativação depende da preparação do ambiente pela administração.</p><div className={styles.actions}>
        {(["ADMIN_ONLY", "SCOPED"] as const).map(mode => <button key={mode} type="button" className={buttonClass} disabled={busy || view.policy.mode === mode} onClick={() => void request({ action: "SET_ACCESS_MODE", mode, expectedVersion: view.policy.version })}>{mode === "SCOPED" ? "Permitir entrada por nome nas filiais liberadas" : "Restringir entrada à administração"}</button>)}
      </div></details>
      <Field label="Operador para consultar ou alterar">{id => <select id={id} className={controlClass} disabled={busy || editingDirty} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Cadastrar novo operador</option>{view.operators.map(item => <option key={item.id} value={item.id}>{item.displayName} · {item.username} · {item.active ? "ativo" : "inativo"}</option>)}</select>}</Field>
      {editingDirty && <button type="button" className={buttonClass} disabled={busy} onClick={() => { setEditorReset(value => value + 1); setEditingDirty(false); }}>Descartar edição de acesso e manter os dados salvos</button>}
      <OperatorEditor key={`${operator ? `${operator.id}:${operator.permissionVersion}` : "new"}:${editorReset}`} operator={operator} busy={busy} submit={command => void request(command)} onDirty={setEditingDirty} />
    </>}
  </details>;
}

export function OperatorAdministration() {
  const access = useEscalaClientAccess();
  return access?.channel === "ACCOUNT" && access.administrator && access.allBranches ? <Administration /> : null;
}
