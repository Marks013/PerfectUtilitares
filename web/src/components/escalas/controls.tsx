import { useId, type ReactNode } from "react";

export const controlClass =
  "min-h-11 w-full min-w-0 app-radius-lg border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2 text-base text-[color:var(--app-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] disabled:opacity-50";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 app-radius-lg border border-[color:var(--app-border)] px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-40";
export const primaryClass = `${buttonClass} bg-[color:var(--app-teal)] text-[color:var(--app-canvas)]`;
export const panelClass =
  "space-y-4 app-radius-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:p-5";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-[color:var(--app-muted)]">{hint}</p>}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-[color:var(--app-teal)]"
      />
      <span>{label}</span>
    </label>
  );
}
