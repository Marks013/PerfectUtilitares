"use client";

import { useId } from "react";
import { storeClosingLabel } from "@/lib/escalas/store-hours";
import type { EscalaInput } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field } from "./controls";
import styles from "./escalas.module.css";
import { changeStoreClosingMinutes } from "./workspace-model";

export function StoreClosingOption({ input, disabled, onChange }: {
  input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void;
}) {
  const hint = useId();
  return <div className={styles.stackSmall}>
    <div className={styles.actions}>
      <Field label="Fechamento da loja">{id => <input
        id={id}
        type="time"
        step={60}
        value={storeClosingLabel(input)}
        disabled={disabled}
        aria-describedby={hint}
        className={controlClass}
        onChange={event => {
          const value = event.target.value;
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
          const [hours, minutes] = value.split(":").map(Number);
          onChange(changeStoreClosingMinutes(input, hours * 60 + minutes || 1440));
        }}
      />}</Field>
      <button type="button" className={`${buttonClass} ${styles.quietAction}`}
        disabled={disabled || input.storeClosingMinutes === undefined}
        onClick={() => onChange(changeStoreClosingMinutes(input, undefined))}>Usar padrão da filial</button>
    </div>
    <p id={hint} className={styles.muted}>As jornadas propostas terminam até este horário. Padrão desta filial: {storeClosingLabel({ ...input, storeClosingMinutes: undefined })}. Ao mudar, gere novamente.</p>
  </div>;
}
