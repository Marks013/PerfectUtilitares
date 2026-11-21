"use client";

import { LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./operational-access.module.css";
import { buttonClass, controlClass, primaryClass } from "./controls";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { EscalaAccessProvider } from "./access-context";
import { ESCALA_ACCESS_REQUEST_TIMEOUT_MS, startOperatorSession } from "./operational-client";
import { EscalaRequestError } from "./workspace-feedback-model";
import { ESCALA_CAPABILITIES, ESCALA_OPERATOR_CAPABILITIES } from "@/lib/escalas/permissions";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";

type Access = "ACCOUNT" | "MODULE" | null;

const contextKeys = new Set(["channel", "roleLabel", "administrator", "allBranches", "branches", "expiresAt"]);
const branchKeys = new Set(["code", "label", "capabilities"]);
const capabilities = new Set<string>(ESCALA_CAPABILITIES);
const nominalCapabilities = new Set<string>(ESCALA_OPERATOR_CAPABILITIES);
const accountBranchCapabilities = new Set<string>([...ESCALA_OPERATOR_CAPABILITIES, "workspace.publish"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function isoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const time = Date.parse(value);
  return Boolean(match && Number.isFinite(time) && new Date(time).toISOString() === `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`);
}
function clientContext(value: unknown): value is EscalaClientAccess {
  if (!record(value) || Object.keys(value).some(key => !contextKeys.has(key))
    || (value.channel !== "ACCOUNT" && value.channel !== "USERNAME")
    || typeof value.roleLabel !== "string" || !value.roleLabel.trim()
    || typeof value.administrator !== "boolean" || typeof value.allBranches !== "boolean" || !Array.isArray(value.branches)
    || (value.expiresAt !== undefined && !isoInstant(value.expiresAt))) return false;
  if (value.channel === "USERNAME" ? value.administrator || value.allBranches : value.administrator !== value.allBranches) return false;
  const allowed = value.channel === "USERNAME" ? nominalCapabilities : value.administrator ? capabilities : accountBranchCapabilities;
  const codes = new Set<string>();
  for (const branch of value.branches) {
    if (!record(branch) || Object.keys(branch).some(key => !branchKeys.has(key))
      || typeof branch.code !== "string" || !branch.code || canonicalBranchCode(branch.code) !== branch.code
      || typeof branch.label !== "string" || !branch.label.trim() || !Array.isArray(branch.capabilities)
      || Array.from(branch.capabilities).some(capability => typeof capability !== "string" || !allowed.has(capability))
      || new Set(branch.capabilities).size !== branch.capabilities.length || codes.has(branch.code)) return false;
    codes.add(branch.code);
  }
  return true;
}
function usableContext(access: Access, context: unknown, expiresAt?: string): context is EscalaClientAccess {
  if (!clientContext(context) || (expiresAt !== undefined && (!isoInstant(expiresAt) || Date.parse(expiresAt) <= Date.now()))
    || (context.expiresAt !== undefined && Date.parse(context.expiresAt) <= Date.now())
    || (expiresAt !== undefined && context.expiresAt !== undefined && Date.parse(expiresAt) !== Date.parse(context.expiresAt))) return false;
  if (access === "ACCOUNT") return context.channel === "ACCOUNT";
  return access === "MODULE" && context.channel === "USERNAME" && expiresAt !== undefined;
}

function loginError(cause: unknown) {
  if (cause instanceof EscalaRequestError) {
    if (cause.status === 503) return "O serviço de acesso está indisponível agora. Tente novamente; nenhum novo acesso foi confirmado.";
    if (cause.status === 429) return "Houve muitas tentativas. Aguarde um pouco antes de tentar novamente.";
    if (cause.status === 400) return "Informe um nome cadastrado válido e tente novamente.";
    if (cause.status === 401 || cause.status === 403) return "O acesso não foi liberado. Confira o nome cadastrado e a permissão com o administrador.";
  }
  return "Não foi possível confirmar o acesso. Confira a conexão e tente novamente.";
}

export function EscalaAccessBoundary({ children, initialAccess, initialExpiresAt, initialContext = null }: {
  children: ReactNode; initialAccess: Access; initialExpiresAt?: string; initialContext?: EscalaClientAccess | null;
}) {
  const validInitial = usableContext(initialAccess, initialContext, initialExpiresAt);
  const [context, setContext] = useState(validInitial ? initialContext : null);
  const [access, setAccess] = useState(initialAccess);
  const [mounted, setMounted] = useState(validInitial);
  const [locked, setLocked] = useState(!validInitial);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialAccess && !validInitial ? "O contexto de acesso precisa ser conferido novamente." : "");
  const pending = useRef(false);
  const loginRequest = useRef<AbortController | null>(null);
  const lockRequest = useRef<AbortController | null>(null);
  const [accessEpoch, setAccessEpoch] = useState(0);
  const usernameField = useRef<HTMLInputElement>(null);
  const accountRecovery = useRef<HTMLHeadingElement>(null);
  const workspaceElement = useRef<HTMLElement>(null);
  const initial = useRef({ access: initialAccess, context: initialContext, expiresAt: initialExpiresAt });
  const incoming = useRef(initial.current);
  if (incoming.current.access !== initialAccess || incoming.current.context !== initialContext || incoming.current.expiresAt !== initialExpiresAt) {
    incoming.current = { access: initialAccess, context: initialContext, expiresAt: initialExpiresAt };
  }
  const stopRequests = useCallback(() => {
    loginRequest.current?.abort(); loginRequest.current = null;
    lockRequest.current?.abort(); lockRequest.current = null;
    pending.current = false;
  }, []);
  const requireUnlock = useCallback(() => {
    stopRequests(); setBusy(false); setContext(null); setLocked(true); setError("");
  }, [stopRequests]);
  useEffect(() => () => stopRequests(), [stopRequests]);
  useEffect(() => {
    const previous = initial.current;
    if (previous.access === initialAccess && previous.context === initialContext && previous.expiresAt === initialExpiresAt) return;
    initial.current = incoming.current;
    stopRequests(); setBusy(false); setUsername("");
    const valid = usableContext(initialAccess, initialContext, initialExpiresAt);
    setContext(valid ? initialContext : null); setAccess(initialAccess); setExpiresAt(initialExpiresAt);
    setMounted(valid); setLocked(!valid); setAccessEpoch(value => value + 1);
    setError(initialAccess && !valid ? "O contexto de acesso precisa ser conferido novamente." : "");
  }, [initialAccess, initialContext, initialExpiresAt, stopRequests]);
  useEffect(() => {
    window.addEventListener("escalas:unlock-required", requireUnlock);
    return () => window.removeEventListener("escalas:unlock-required", requireUnlock);
  }, [requireUnlock]);
  useEffect(() => {
    if (locked && !busy) { if (access === "ACCOUNT") accountRecovery.current?.focus(); else usernameField.current?.focus(); }
  }, [locked, access, busy]);
  useEffect(() => {
    if (locked || access !== "MODULE" || !expiresAt) return;
    const expire = () => window.dispatchEvent(new Event("escalas:unlock-required"));
    const timer = window.setTimeout(expire, Math.max(0, Date.parse(expiresAt) - Date.now()));
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() >= Date.parse(expiresAt)) expire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [access, expiresAt, locked]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || access === "ACCOUNT" || initial.current !== incoming.current) return;
    pending.current = true; setBusy(true); setError("");
    const abort = new AbortController(); loginRequest.current = abort;
    const scope = incoming.current;
    try {
      const result = await startOperatorSession(username, fetch, abort.signal);
      if (loginRequest.current !== abort || abort.signal.aborted || incoming.current !== scope) return;
      const nextAccess = result.access.role === "ACCOUNT" ? "ACCOUNT" : "MODULE";
      if (!usableContext(nextAccess, result.context, result.access.expiresAt)) throw new Error("Invalid access response");
      // No stable principal identity is exposed by the DTO. Replace the whole visual scope on every entry.
      setContext(result.context); setAccessEpoch(value => value + 1);
      setExpiresAt(result.access.expiresAt); setAccess(nextAccess); setMounted(true); setLocked(false); setUsername("");
      window.dispatchEvent(new Event("escalas:unlocked"));
      requestAnimationFrame(() => workspaceElement.current?.focus({ preventScroll: true }));
    } catch (cause) { if (loginRequest.current === abort && !abort.signal.aborted && incoming.current === scope) setError(loginError(cause)); }
    finally { if (loginRequest.current === abort) { loginRequest.current = null; pending.current = false; setBusy(false); } }
  }
  function cancelLogin() {
    const previous = loginRequest.current;
    loginRequest.current = null; previous?.abort();
    pending.current = false; setBusy(false); setError("Tentativa cancelada. Confira o nome e tente novamente.");
  }
  async function lockModule() {
    if (pending.current || locked || access !== "MODULE" || initial.current !== incoming.current) return;
    pending.current = true; setBusy(true); setError("");
    const abort = new AbortController(); lockRequest.current = abort;
    const scope = incoming.current;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(ESCALA_ACCESS_REQUEST_TIMEOUT_MS)]);
    try {
      const response = await fetch("/api/escalas/access/session", { method: "DELETE", cache: "no-store", signal });
      if (lockRequest.current !== abort || abort.signal.aborted || incoming.current !== scope) return;
      signal.throwIfAborted();
      if (!response.ok || response.status < 200 || response.status >= 300 || response.status === 204) throw new Error("Lock not confirmed");
      const confirmation: unknown = await response.json();
      if (lockRequest.current !== abort || abort.signal.aborted || incoming.current !== scope) return;
      signal.throwIfAborted();
      if (!record(confirmation) || confirmation.revoked !== true) throw new Error("Lock not confirmed");
      window.dispatchEvent(new Event("escalas:unlock-required"));
    } catch { if (lockRequest.current === abort && !abort.signal.aborted && incoming.current === scope) setError("Não foi possível confirmar o bloqueio. Tente novamente antes de deixar este dispositivo."); }
    finally { if (lockRequest.current === abort) { lockRequest.current = null; pending.current = false; setBusy(false); } }
  }
  if (initial.current !== incoming.current) return <p role="status" className={styles.description}>Conferindo o acesso atualizado…</p>;
  const validCurrent = usableContext(access, context, expiresAt);
  if (!locked && !validCurrent) return <section className={styles.card} aria-labelledby="escala-context-unavailable-title">
    <h1 id="escala-context-unavailable-title" className={styles.title}>Confira o contexto do acesso</h1>
    <p role="alert" className={styles.error}>O contexto de acesso não foi confirmado. Recarregue a página para conferir suas permissões.</p>
    <a className={buttonClass} href="/escala">Conferir acesso novamente</a>
  </section>;
  return <div>
    {locked && access === "ACCOUNT" ? <section className={styles.card} aria-labelledby="escala-account-recovery-title">
      <h1 ref={accountRecovery} tabIndex={-1} id="escala-account-recovery-title" className={styles.title}>Confira o acesso da sua conta</h1>
      <p role="alert" className={styles.error}>{error || "O acesso da conta precisa ser conferido novamente. A entrada por nome não substitui as permissões desta conta."}</p>
      <a className={buttonClass} href="/escala">Conferir acesso da conta</a>
    </section> : locked && <section className={styles.card} aria-labelledby="escala-access-title">
      <LockKeyhole className={styles.icon} aria-hidden="true" />
      <h1 id="escala-access-title" className={styles.title}>Acesso ao planejamento de escalas</h1>
      <p className={styles.description}>{mounted ? "O acesso foi bloqueado ou expirou. Ao entrar novamente, a lista autorizada será carregada do início. Se houver um rascunho guardado neste navegador, ele precisará de recuperação explícita. Nenhuma edição será enviada automaticamente pelo novo acesso." : "Informe o nome cadastrado pelo administrador para abrir as filiais liberadas para você."}</p>
      <form onSubmit={unlock} className={styles.form} aria-busy={busy}>
        <label className={styles.label} htmlFor="escala-access-username">Nome cadastrado</label>
        <input ref={usernameField} id="escala-access-username" autoComplete="username" required maxLength={160} disabled={busy} value={username} onChange={event => setUsername(event.target.value)} className={controlClass} aria-invalid={Boolean(error)} aria-describedby={error ? "escala-access-error escala-access-help" : "escala-access-help"} />
        <p id="escala-access-help" className={styles.description}>O nome seleciona seu acesso às filiais; não comprova identidade pessoal. Para administrar, entre na sua conta administrativa.</p>
        {error && <p id="escala-access-error" role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className={primaryClass} disabled={busy}>{busy ? "Verificando acesso…" : error ? "Tentar novamente" : mounted ? "Entrar e abrir um novo acesso" : "Liberar planejamento"}</button>
        {busy && loginRequest.current && <button type="button" className={buttonClass} onClick={cancelLogin}>Cancelar tentativa</button>}
      </form>
    </section>}
    {!locked && access === "MODULE" && <div className={styles.accessBar}><p>{context?.roleLabel ?? "Acesso da filial"} · somente filiais autorizadas</p><button type="button" className={buttonClass} disabled={busy} onClick={lockModule}>{busy ? "Bloqueando…" : "Bloquear Escalas"}</button></div>}
    {!locked && error && <p role="alert" className={styles.error}>{error}</p>}
    {mounted && !locked && context && initial.current === incoming.current && validCurrent && <section key={accessEpoch} ref={workspaceElement} tabIndex={-1} aria-label="Planejamento de escalas"><EscalaAccessProvider value={context}>{children}</EscalaAccessProvider></section>}
  </div>;
}
