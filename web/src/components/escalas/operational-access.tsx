"use client";

import { LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./operational-access.module.css";
import { buttonClass, controlClass, primaryClass } from "./controls";

type Access = "ACCOUNT" | "MODULE" | null;
type SessionResult = { access?: { role?: string; expiresAt?: string }; error?: { message?: string } };

export function EscalaAccessBoundary({ children, initialAccess, initialExpiresAt }: {
  children: ReactNode; initialAccess: Access; initialExpiresAt?: string;
}) {
  const [access, setAccess] = useState(initialAccess);
  const [mounted, setMounted] = useState(Boolean(initialAccess));
  const [locked, setLocked] = useState(!initialAccess);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const passwordField = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const requireUnlock = useCallback(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLocked(true);
    setError("");
  }, []);
  useEffect(() => {
    window.addEventListener("escalas:unlock-required", requireUnlock);
    return () => window.removeEventListener("escalas:unlock-required", requireUnlock);
  }, [requireUnlock]);
  useEffect(() => { if (locked) passwordField.current?.focus(); }, [locked]);
  useEffect(() => {
    if (locked || access !== "MODULE" || !expiresAt) return;
    const delay = Date.parse(expiresAt) - Date.now();
    const expire = () => window.dispatchEvent(new Event("escalas:unlock-required"));
    const timer = window.setTimeout(expire, Math.max(0, delay));
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() >= Date.parse(expiresAt)) expire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [access, expiresAt, locked]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/escalas/access/session", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json() as SessionResult;
      if (!response.ok) { setError(result.error?.message || "Não foi possível liberar o acesso. Confira a senha e tente novamente."); return; }
      if (result.access?.role !== "OPERATIONAL" || !result.access.expiresAt || !Number.isFinite(Date.parse(result.access.expiresAt))) throw new Error("Invalid access response");
      setExpiresAt(result.access.expiresAt); setAccess("MODULE"); setMounted(true); setLocked(false); setPassword(""); setShowPassword(false);
      window.dispatchEvent(new Event("escalas:unlocked"));
      requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); });
    } catch { setError("A conexão falhou. Seu rascunho continua nesta tela; confira a conexão e tente novamente."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function lockModule() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/escalas/access/session", { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error("Lock not confirmed");
      window.dispatchEvent(new Event("escalas:unlock-required"));
    } catch { setError("Não foi possível confirmar o bloqueio. Tente novamente antes de deixar este dispositivo."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div>
    {locked && <section className={styles.card} aria-labelledby="escala-access-title">
      <LockKeyhole className={styles.icon} aria-hidden="true" />
      <h1 id="escala-access-title" className={styles.title}>Acesso ao planejamento de escalas</h1>
      <p className={styles.description}>{mounted ? "O acesso foi bloqueado ou expirou. Informe a senha para continuar; seu rascunho foi mantido nesta tela." : "Use a senha operacional padrão do Unimed para planejar as filiais da empresa padrão. Não é necessário entrar na conta administrativa."}</p>
      <form onSubmit={unlock} className={styles.form} aria-busy={busy}>
        <label className={styles.label} htmlFor="escala-access-password">Senha operacional</label>
        <input ref={passwordField} id="escala-access-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={72} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className={controlClass} aria-describedby={error ? "escala-access-error" : undefined} />
        <button type="button" className={buttonClass} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Ocultar senha" : "Mostrar senha"}</button>
        {error && <p id="escala-access-error" role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className={primaryClass} disabled={busy}>{busy ? "Verificando acesso…" : "Liberar planejamento"}</button>
      </form>
    </section>}
    {!locked && access === "MODULE" && <div className={styles.accessBar}><p>Acesso operacional compartilhado · somente empresa padrão</p><button type="button" className={buttonClass} disabled={busy} onClick={lockModule}>{busy ? "Bloqueando…" : "Bloquear Escalas"}</button></div>}
    {!locked && error && <p role="alert" className={styles.error}>{error}</p>}
    {mounted && <div hidden={locked} inert={locked}>{children}</div>}
  </div>;
}
