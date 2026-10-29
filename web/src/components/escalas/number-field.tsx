"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass, Field } from "./controls";
import styles from "./escalas.module.css";

/** An incomplete number belongs to the editor, not to the persisted scenario. */
export function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState("");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  function parse(raw: string) {
    const numeric = raw.trim() === "" ? NaN : Number(raw);
    return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
  }
  return <div><Field label={label} hint={hint}>{id => <input id={id} type="number" inputMode="numeric" min={min} max={max} value={text} className={controlClass} aria-invalid={Boolean(error)} onFocus={() => { focused.current = true; }} onChange={event => {
    setText(event.target.value); setError(""); const number = parse(event.target.value); if (number !== null && number !== value) onChange(number);
  }} onBlur={() => {
    focused.current = false; const number = parse(text);
    if (number === null) setError("Informe um número inteiro entre " + min + " e " + max + ". O último valor válido foi mantido no cenário.");
    else if (number !== value) onChange(number);
  }} />}</Field>{error && <p role="alert" className={styles.errorText}>{error}</p>}</div>;
}
