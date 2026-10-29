import { useId, type ReactNode } from "react";
import styles from "./escalas.module.css";

export const controlClass = styles.control;
export const buttonClass = styles.button;
export const primaryClass = `${styles.button} ${styles.primaryAction}`;
export const panelClass = styles.panel;

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
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className={styles.fieldHint}>{hint}</p>}
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
