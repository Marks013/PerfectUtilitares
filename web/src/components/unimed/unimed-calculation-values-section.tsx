import {
  CircleDollarSign,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { UnimedBeneficiary } from "./unimed-beneficiary-search";
import {
  FieldLabel,
  MoneyInput,
} from "./unimed-calculation-fields";
import type {
  DependentValues,
  FieldErrors,
  FormValues,
  MoneyField,
} from "./unimed-calculation-types";
import {
  MAX_DEPENDENTS,
  createDependent,
} from "./unimed-calculation-utils";

type ValuesSectionProps = {
  form: FormValues;
  errors: FieldErrors;
  selectedBeneficiary: UnimedBeneficiary | null;
  updateForm: <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => void;
  updateHolder: (field: MoneyField, value: string) => void;
  blurMoney: (field: MoneyField) => void;
  updateDependent: (
    id: string,
    field: keyof Omit<DependentValues, "id">,
    value: string,
  ) => void;
  blurDependentMoney: (
    dependent: DependentValues,
    field: "invoicePlanAmount" | "addonAmount",
  ) => void;
};

export function UnimedCalculationValuesSection({
  form,
  errors,
  selectedBeneficiary,
  updateForm,
  updateHolder,
  blurMoney,
  updateDependent,
  blurDependentMoney,
}: ValuesSectionProps) {
  return (
    <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-lime)]">
          <CircleDollarSign className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-black text-[color:var(--app-fg)]">
            3. Valores do plano
          </h2>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            Nenhum preço é presumido. Use valores da competência ativa.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
        <p className="mb-3 text-xs font-black tracking-wide text-[color:var(--app-muted)] uppercase">
          Titular
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <MoneyInput
            id="unimed-invoice"
            label="Plano na fatura"
            value={form.holder.invoicePlanAmount}
            error={errors.invoicePlanAmount}
            onChange={(value) => updateHolder("invoicePlanAmount", value)}
            onBlur={() => blurMoney("invoicePlanAmount")}
          />
          <MoneyInput
            id="unimed-payroll"
            label="Plano em folha"
            value={form.holder.payrollPlanAmount}
            error={errors.payrollPlanAmount}
            onChange={(value) => updateHolder("payrollPlanAmount", value)}
            onBlur={() => blurMoney("payrollPlanAmount")}
          />
          <MoneyInput
            id="unimed-addon"
            label="Acessório Funeral"
            value={form.holder.addonAmount}
            error={errors.addonAmount}
            onChange={(value) => updateHolder("addonAmount", value)}
            onBlur={() => blurMoney("addonAmount")}
            hint={
              selectedBeneficiary
                ? `Identificação automática: ${selectedBeneficiary.hasAddon ? "possui" : "não possui"}.`
                : "Use 0,00 quando não houver Acessório Funeral."
            }
          />
        </div>
      </div>

      <div className="mt-7 border-t border-[color:var(--app-border)] pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <UsersRound
              className="size-5 text-[color:var(--app-teal)]"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-black text-[color:var(--app-fg)]">
                Dependentes
              </h3>
              <p className="text-xs text-[color:var(--app-muted)]">
                Até {MAX_DEPENDENTS} dependentes por cálculo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              updateForm("dependents", [
                ...form.dependents,
                createDependent(),
              ])
            }
            disabled={form.dependents.length >= MAX_DEPENDENTS}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="size-4" aria-hidden="true" />
            Adicionar dependente
          </button>
        </div>

        {form.dependents.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-5 text-center text-sm text-[color:var(--app-muted)]">
            Nenhum dependente incluído neste cálculo.
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-xl border border-[color:var(--app-border)]">
            {form.dependents.map((dependent, index) => {
              const dependentError = errors[`dependent-${dependent.id}`];
              return (
                <div
                  key={dependent.id}
                  className="border-b border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 last:border-b-0"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-black text-[color:var(--app-fg)]">
                      Dependente {index + 1}
                    </h4>
                    <button
                      type="button"
                      onClick={() =>
                        updateForm(
                          "dependents",
                          form.dependents.filter(
                            (item) => item.id !== dependent.id,
                          ),
                        )
                      }
                      className="grid size-9 place-items-center rounded-lg border border-[color:var(--app-border)] text-[color:var(--app-coral)] transition hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover dependente ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <FieldLabel
                        htmlFor={`dependent-${dependent.id}-name`}
                      >
                        Nome
                      </FieldLabel>
                      <input
                        id={`dependent-${dependent.id}-name`}
                        type="text"
                        placeholder="Opcional para o cálculo"
                        value={dependent.name}
                        onChange={(event) =>
                          updateDependent(
                            dependent.id,
                            "name",
                            event.target.value,
                          )
                        }
                        className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                      />
                    </div>
                    <MoneyInput
                      id={`dependent-${dependent.id}-invoice`}
                      label="Plano na fatura"
                      value={dependent.invoicePlanAmount}
                      error={dependentError}
                      onChange={(value) =>
                        updateDependent(
                          dependent.id,
                          "invoicePlanAmount",
                          value,
                        )
                      }
                      onBlur={() =>
                        blurDependentMoney(dependent, "invoicePlanAmount")
                      }
                    />
                    <MoneyInput
                      id={`dependent-${dependent.id}-addon`}
                      label="Acessório Funeral"
                      value={dependent.addonAmount}
                      error={dependentError}
                      onChange={(value) =>
                        updateDependent(
                          dependent.id,
                          "addonAmount",
                          value,
                        )
                      }
                      onBlur={() =>
                        blurDependentMoney(dependent, "addonAmount")
                      }
                      hint={`Identificação automática: ${dependent.hasAddon ? "possui" : "não possui"}.`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
