import { cloneElement, isValidElement, useId, type AriaAttributes, type ReactNode } from "react";
import styles from "./escalas.module.css";

export const controlClass = styles.control;
export const buttonClass = styles.button;
export const primaryClass = `${styles.button} ${styles.primaryAction}`;
export const panelClass = styles.panel;

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: (id: string, accessibility: Pick<AriaAttributes, "aria-describedby" | "aria-invalid">) => ReactNode;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const description = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const control = children(id, { "aria-describedby": description, "aria-invalid": error ? true : undefined });
  // Assim, campos que ainda não repassam o segundo argumento conservam a ajuda.
  const described = description && isValidElement<Pick<AriaAttributes, "aria-describedby" | "aria-invalid">>(control) && typeof control.type === "string"
    ? cloneElement(control, {
      "aria-describedby": [...new Set([control.props["aria-describedby"], description].filter(Boolean).join(" ").trim().split(/\s+/))].join(" "),
      ...(error ? { "aria-invalid": true } : {}),
    })
    : control;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      {described}
      {hint && <p id={`${id}-hint`} className={styles.fieldHint}>{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className={styles.errorText}>{error}</p>}
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
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={styles.checkInput}
      />
      <span>{label}</span>
    </label>
  );
}
