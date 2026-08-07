import { CalendarDays } from "lucide-react";
import {
  FieldError,
  FieldLabel,
} from "./unimed-calculation-fields";
import type {
  FieldErrors,
  FormValues,
  UnimedExclusionReasonOption,
} from "./unimed-calculation-types";

type MovementSectionProps = {
  form: FormValues;
  errors: FieldErrors;
  reasons: readonly UnimedExclusionReasonOption[];
  updateForm: <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => void;
  updateExclusionDate: (value: string) => void | Promise<void>;
};

export function UnimedCalculationMovementSection({
  form,
  errors,
  reasons,
  updateForm,
  updateExclusionDate,
}: MovementSectionProps) {
  return (
    <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-gold)]">
          <CalendarDays className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-black text-[color:var(--app-fg)]">
            2. Informações complementares
          </h2>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            Motivo, datas e situação do fechamento da fatura.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <FieldLabel htmlFor="unimed-reason" required>
            Motivo da exclusão
          </FieldLabel>
          <select
            id="unimed-reason"
            value={form.reasonCode}
            onChange={(event) =>
              updateForm("reasonCode", event.target.value)
            }
            aria-invalid={Boolean(errors.reasonCode)}
            aria-describedby={
              errors.reasonCode ? "unimed-reason-error" : undefined
            }
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          >
            <option value="">Selecione o motivo</option>
            {reasons.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.code}. {reason.label}
              </option>
            ))}
          </select>
          <FieldError
            id="unimed-reason-error"
            message={errors.reasonCode}
          />
        </div>

        <div>
          <FieldLabel htmlFor="unimed-enrollment" required>
            Inclusão no plano
          </FieldLabel>
          <input
            id="unimed-enrollment"
            type="date"
            value={form.planEnrollmentDate}
            max={form.exclusionDate || undefined}
            onChange={(event) =>
              updateForm("planEnrollmentDate", event.target.value)
            }
            aria-invalid={Boolean(errors.planEnrollmentDate)}
            aria-describedby={
              errors.planEnrollmentDate
                ? "unimed-enrollment-error"
                : undefined
            }
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          />
          <FieldError
            id="unimed-enrollment-error"
            message={errors.planEnrollmentDate}
          />
        </div>

        <div>
          <FieldLabel htmlFor="unimed-exclusion" required>
            Data de exclusão
          </FieldLabel>
          <input
            id="unimed-exclusion"
            type="date"
            value={form.exclusionDate}
            min={form.planEnrollmentDate || undefined}
            onChange={(event) =>
              void updateExclusionDate(event.target.value)
            }
            aria-invalid={Boolean(errors.exclusionDate)}
            aria-describedby={
              errors.exclusionDate ? "unimed-exclusion-error" : undefined
            }
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          />
          <FieldError
            id="unimed-exclusion-error"
            message={errors.exclusionDate}
          />
        </div>

        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-bold text-[color:var(--app-fg)]">
            Fechamento da fatura
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                [
                  "AUTOMATIC_DAY_25",
                  "Fechamento automático",
                  "Dia 25 da competência",
                ],
                ["OPEN", "Fatura aberta", "Sem fechamento aplicado"],
              ] as const
            ).map(([value, title, description]) => (
              <label
                key={value}
                className="flex cursor-pointer gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 transition has-[:checked]:border-[color:var(--app-teal)] has-[:checked]:bg-[color:var(--app-success-soft)]"
              >
                <input
                  type="radio"
                  name="billing-closure"
                  value={value}
                  checked={form.billingClosure === value}
                  onChange={() => updateForm("billingClosure", value)}
                  className="mt-1 size-4 shrink-0"
                />
                <span>
                  <span className="block text-sm font-black text-[color:var(--app-fg)]">
                    {title}
                  </span>
                  <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
