import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { normalizeMoney } from "./unimed-calculation-utils";

export function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-bold text-[color:var(--app-fg)]"
    >
      {children}
      {required ? (
        <span className="ml-1 text-[color:var(--app-coral)]" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-[color:var(--app-coral)]"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

export function MoneyInput({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  hint?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-[color:var(--app-subtle)]">
          R$
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={value}
          onChange={(event) => onChange(normalizeMoney(event.target.value))}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] py-2.5 pr-3 pl-10 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)] disabled:opacity-60"
        />
      </div>
      {hint && !error ? (
        <p id={hintId} className="mt-2 text-xs text-[color:var(--app-subtle)]">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function ResultMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "rounded-lg border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-3"
          : "rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3"
      }
    >
      <dt className="text-xs font-bold tracking-wide text-[color:var(--app-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-lg font-black tracking-tight text-[color:var(--app-fg)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}
