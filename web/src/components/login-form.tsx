"use client";

import { KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { loginServerFieldErrors, validateLoginFields, type LoginFieldErrors } from "./login-validation";

type LoginFormProps = {
  action: (formData: FormData) => Promise<void>;
  callbackUrl: string;
  passwordMaxLength: number;
  errorMessage: string | null;
  errorCode?: string;
};

function LoginFields({ callbackUrl, passwordMaxLength, errorMessage, errorCode, clientErrors, unlock }: Omit<LoginFormProps, "action"> & {
  clientErrors: LoginFieldErrors | null;
  unlock: () => void;
}) {
  const { pending } = useFormStatus();
  const summary = useRef<HTMLDivElement>(null);
  const errors = clientErrors ?? loginServerFieldErrors(errorCode);
  const message = clientErrors === null ? errorMessage
    : clientErrors.email || clientErrors.password ? "Confira os campos indicados para entrar." : null;

  useEffect(() => {
    if (!pending) {
      unlock();
      // Also handles consecutive failures with the same server error code.
      if (errorMessage && clientErrors === null) summary.current?.focus();
    }
  }, [pending, errorMessage, clientErrors, unlock]);

  return (
    <>
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 app-text-muted" aria-hidden="true" />
        <h2 className="text-xl font-semibold app-text">Entrar</h2>
      </div>
      <p className="mt-1 text-sm app-text-muted">Use seu e-mail e senha para acessar seu histórico.</p>
      {message && <div ref={summary} tabIndex={-1} role="alert" className="mt-4 app-radius-md border app-border-danger app-bg-danger-soft px-3 py-2 text-sm app-text-danger">{message}</div>}
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        <legend className="sr-only">Dados de acesso</legend>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <label htmlFor="login-email" className="mt-5 block text-sm font-medium app-text">E-mail</label>
        <input
          id="login-email" name="email" type="email" autoComplete="username" maxLength={254} required
          aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "login-email-error" : undefined}
          className="mt-1 min-h-11 w-full app-radius-md border app-border px-3 py-2 text-base sm:text-sm app-focus-border"
          placeholder="nome@empresa.com"
        />
        {errors.email && <p id="login-email-error" className="mt-1 text-sm app-text-danger">{errors.email}</p>}
        <label htmlFor="login-password" className="mt-4 block text-sm font-medium app-text">Senha</label>
        <input
          id="login-password" name="password" type="password" autoComplete="current-password" maxLength={passwordMaxLength} required
          aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "login-password-error" : undefined}
          className="mt-1 min-h-11 w-full app-radius-md border app-border px-3 py-2 text-base sm:text-sm app-focus-border"
          placeholder="Digite sua senha"
        />
        {errors.password && <p id="login-password-error" className="mt-1 text-sm app-text-danger">{errors.password}</p>}
        <button
          type="submit" disabled={pending} aria-busy={pending} aria-label={pending ? "Entrando…" : "Entrar"}
          className="app-primary-button mt-5 grid min-h-11 w-full items-center justify-items-center app-radius-md px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          <span aria-hidden="true" className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}>Entrar</span>
          <span aria-hidden="true" className={`col-start-1 row-start-1 inline-flex items-center gap-2 ${pending ? "" : "invisible"}`}>
            <Loader2 className="size-4 animate-spin" />Entrando…
          </span>
        </button>
      </fieldset>
      <p role="status" aria-live="polite" className="mt-2 min-h-6 text-sm app-text-muted">{pending ? "Verificando seus dados de acesso…" : ""}</p>
      <Link href="/esqueci-senha" className="mt-3 inline-flex min-h-11 w-full items-center justify-center app-radius-md border app-border px-3 py-2 text-sm font-medium app-text-muted app-hover-surface">Esqueci minha senha</Link>
      <Link href="/dashboard" className="mt-3 inline-flex min-h-11 w-full items-center justify-center app-radius-md border app-border-success px-3 py-2 text-sm font-medium app-text-success app-hover-surface">Continuar sem entrar</Link>
    </>
  );
}

export function LoginForm({ action, ...props }: LoginFormProps) {
  const [clientErrors, setClientErrors] = useState<LoginFieldErrors | null>(null);
  const submitting = useRef(false);
  const unlock = useCallback(() => { submitting.current = false; }, []);

  function validate(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) { event.preventDefault(); return; }
    const email = event.currentTarget.elements.namedItem("email");
    const password = event.currentTarget.elements.namedItem("password");
    if (!(email instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) {
      event.preventDefault();
      return;
    }
    const errors = validateLoginFields(email.value, password.value, email.validity.typeMismatch);
    if (errors.email || errors.password) {
      event.preventDefault();
      setClientErrors(errors);
      (errors.email ? email : password).focus();
      return;
    }
    setClientErrors(null);
    submitting.current = true;
  }

  return (
    <form action={action} onSubmit={validate} noValidate className="login-gateway__form w-full max-w-sm app-radius-lg border app-border app-bg-card p-6 app-shadow">
      <LoginFields {...props} clientErrors={clientErrors} unlock={unlock} />
    </form>
  );
}
