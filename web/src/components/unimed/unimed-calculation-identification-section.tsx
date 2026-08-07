import { UserRound } from "lucide-react";
import {
  type UnimedBeneficiary,
  UnimedBeneficiarySearch,
  type UnimedPricingContext,
} from "./unimed-beneficiary-search";
import {
  FieldError,
  FieldLabel,
} from "./unimed-calculation-fields";
import type {
  FieldErrors,
  FormValues,
} from "./unimed-calculation-types";
import { formatCpf } from "./unimed-calculation-utils";

type IdentificationSectionProps = {
  form: FormValues;
  errors: FieldErrors;
  selectedBeneficiary: UnimedBeneficiary | null;
  pricingWarnings: string[];
  selectBeneficiary: (
    beneficiary: UnimedBeneficiary,
    pricingContext: UnimedPricingContext,
  ) => void;
  clearSelectedBeneficiary: () => void;
  updateForm: <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => void;
};

export function UnimedCalculationIdentificationSection({
  form,
  errors,
  selectedBeneficiary,
  pricingWarnings,
  selectBeneficiary,
  clearSelectedBeneficiary,
  updateForm,
}: IdentificationSectionProps) {
  return (
    <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
          <UserRound className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-black text-[color:var(--app-fg)]">
            1. Identificação
          </h2>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            Dados usados na conferência e confirmação do e-mail.
          </p>
        </div>
      </div>

      <UnimedBeneficiarySearch
        selected={selectedBeneficiary}
        referenceDate={form.exclusionDate || undefined}
        onSelect={selectBeneficiary}
        onClear={clearSelectedBeneficiary}
      />

      {pricingWarnings.length > 0 ? (
        <div
          className="mt-4 rounded-xl border border-[color:var(--app-gold)] bg-[color:var(--app-warning-soft)] p-4"
          role="status"
        >
          <p className="text-sm font-black text-[color:var(--app-fg)]">
            Campos que precisam de conferência
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[color:var(--app-muted)]">
            {pricingWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="unimed-name" required>
            Nome do colaborador
          </FieldLabel>
          <input
            id="unimed-name"
            type="text"
            autoComplete="name"
            placeholder="Digite o nome completo"
            value={form.employeeName}
            onChange={(event) =>
              updateForm("employeeName", event.target.value)
            }
            aria-invalid={Boolean(errors.employeeName)}
            aria-describedby={
              errors.employeeName ? "unimed-name-error" : undefined
            }
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          />
          <FieldError
            id="unimed-name-error"
            message={errors.employeeName}
          />
        </div>
        <div>
          <FieldLabel htmlFor="unimed-cpf" required>
            CPF do Titular
          </FieldLabel>
          <input
            id="unimed-cpf"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            maxLength={14}
            value={form.cpf}
            onChange={(event) =>
              updateForm("cpf", formatCpf(event.target.value))
            }
            aria-invalid={Boolean(errors.cpf)}
            aria-describedby={errors.cpf ? "unimed-cpf-error" : undefined}
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          />
          <FieldError id="unimed-cpf-error" message={errors.cpf} />
        </div>
      </div>
    </section>
  );
}
