"use client";

import { ChevronDown, type Settings2 } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { formatPtBrDecimal, normalizeDecimalInput } from "@/components/unimed/form-utils";

export type FieldIssue = { fieldId: string; message: string };
export type FieldErrors = Record<string, string>;

export const ConfigFieldContext = createContext<{
  errors: FieldErrors;
  clear: (fieldId: string) => void;
}>({ errors: {}, clear: () => undefined });

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-xs font-black text-[color:var(--app-fg)]"
    >
      {children}
    </label>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
  disabled?: boolean;
}) {
  const validation = useContext(ConfigFieldContext);
  const error = validation.errors[id];
  return (
    <>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          validation.clear(id);
          onChange(event.target.value);
        }}
        className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-70 ${error ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export function DecimalInput({
  id,
  value,
  onChange,
  prefix = "R$",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
}) {
  const validation = useContext(ConfigFieldContext);
  const error = validation.errors[id];
  return (
    <>
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-black text-[color:var(--app-fg)]"
          aria-hidden="true"
        >
          {prefix}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="0,00"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            validation.clear(id);
            onChange(normalizeDecimalInput(event.target.value));
          }}
          onBlur={() => {
            const formatted = formatPtBrDecimal(value);
            if (formatted) onChange(formatted);
          }}
          className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] py-2.5 pr-3 pl-10 text-sm font-semibold text-[color:var(--app-fg)] ${error ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
        />
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-lg font-black text-[color:var(--app-fg)]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--app-muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

export function ConfigSection({
  children,
  className = "",
  defaultOpen = false,
  description,
  icon,
  id,
  title,
}: {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  description: string;
  icon: typeof Settings2;
  id: string;
  title: string;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      tabIndex={-1}
      className={`group scroll-mt-28 rounded-(--app-radius-lg) border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 shadow-[var(--app-shadow)] outline-none focus-within:border-[color:var(--app-teal)] sm:p-6 ${className}`}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] [&::-webkit-details-marker]:hidden">
        <SectionHeading icon={icon} title={title} description={description} />
        <ChevronDown
          className="mt-2 size-5 shrink-0 text-[color:var(--app-fg)] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="min-w-0 border-t border-[color:var(--app-border)] pt-5">
        {children}
      </div>
    </details>
  );
}
