"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FieldErrors } from "./unimed-calculation-types";

const fieldTargets: Record<string, string> = {
  reasonCode: "unimed-reason",
  dependents: "unimed-dependents",
  exclusionDate: "unimed-exclusion",
  planEnrollmentDate: "unimed-enrollment",
};

export function UnimedCalculationFeedback({
  errors,
  message,
  focusRequest,
}: {
  errors: FieldErrors;
  message: string | null;
  focusRequest: number;
}) {
  const alertRef = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors).filter(([, value]) => Boolean(value));

  // Focus only after a requested action settles and React commits the feedback.
  // Editing fields or automatic calculations must not take keyboard focus away.
  useEffect(() => {
    if (!focusRequest) return;
    alertRef.current?.focus({ preventScroll: true });
    alertRef.current?.scrollIntoView({ block: "center" });
  }, [focusRequest]);

  if (!message && entries.length === 0) return null;

  return (
    <div
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      aria-label="Não foi possível concluir"
      className="scroll-mt-24 rounded-xl border-2 border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-4 text-sm text-[color:var(--app-fg)] focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--app-coral)]"
    >
      <p className="flex items-center gap-2 font-black">
        <AlertCircle className="size-5 shrink-0 text-[color:var(--app-coral)]" aria-hidden="true" />
        Não foi possível concluir
      </p>
      {message ? <p className="mt-2 font-semibold">{message}</p> : null}
      {entries.length > 0 ? (
        <>
          <p className="mt-2">Clique em cada pendência para corrigi-la. Depois, tente novamente.</p>
          <ul className="mt-2 space-y-1">
            {entries.map(([field, error]) => (
              <li key={field}>
                <button
                  type="button"
                  className="min-h-11 py-2 text-left font-bold underline underline-offset-4"
                  onClick={() => {
                    const form = alertRef.current?.closest("form");
                    const id = fieldTargets[field] ?? field;
                    const target = form?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
                    if (!target) return;
                    const details = target.closest("details");
                    if (details) details.open = true;
                    const control = target instanceof HTMLDetailsElement
                      ? target.querySelector("summary")
                      : target;
                    control?.focus({ preventScroll: true });
                    control?.scrollIntoView({ block: "center" });
                  }}
                >
                  {error}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
