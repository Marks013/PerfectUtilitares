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
    value: DependentValues[keyof Omit<DependentValues, "id">],
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

      <details className="group rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <div className="min-w-0">
            <p className="text-sm font-black text-[color:var(--app-fg)]">Titular</p>
            <p className="truncate text-xs text-[color:var(--app-muted)]">
              {form.employeeName || "Dados do plano"}
            </p>
          </div>
          <span className="shrink-0 text-xs font-bold text-[color:var(--app-teal)] group-open:hidden">
            Editar
          </span>
          <span className="hidden shrink-0 text-xs font-bold text-[color:var(--app-muted)] group-open:inline">
            Recolher
          </span>
        </summary>
        <div className="grid gap-4 border-t border-[color:var(--app-border)] p-4 md:grid-cols-3">
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
      </details>

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
                createDependent(form.planEnrollmentDate),
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
          <div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--app-border)]">
            {form.dependents.map((dependent, index) => {
              const dependentError = errors[`dependent-${dependent.id}`];
              return (
                <div
                  key={dependent.id}
                  className="flex items-start gap-3 border-b border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-2.5 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={dependent.selected}
                    onChange={(event) =>
                      updateDependent(dependent.id, "selected", event.target.checked)
                    }
                    className="mt-1 size-5 shrink-0 accent-[color:var(--app-teal)]"
                    aria-label={`Incluir ${dependent.name || `dependente ${index + 1}`} no cálculo`}
                  />
                  <details className="group min-w-0 flex-1">
                    <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 marker:hidden">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-black text-[color:var(--app-fg)]">
                          {dependent.name || `Dependente ${index + 1}`}
                        </h4>
                        <p className="text-xs text-[color:var(--app-muted)]">
                          {dependent.selected ? "Incluído no cálculo" : "Fora deste cálculo"}
                          {dependent.age !== null ? ` · ${dependent.age} anos` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-bold text-[color:var(--app-teal)] group-open:hidden">
                        Editar
                      </span>
                      <span className="hidden shrink-0 text-xs font-bold text-[color:var(--app-muted)] group-open:inline">
                        Recolher
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-4 border-t border-[color:var(--app-border)] pt-3 md:grid-cols-2 xl:grid-cols-4">
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
                    <div>
                      <FieldLabel
                        htmlFor={`dependent-${dependent.id}-inclusion-date`}
                      >
                        Inclusão no plano
                      </FieldLabel>
                      <input
                        id={`dependent-${dependent.id}-inclusion-date`}
                        type="date"
                        value={dependent.inclusionDate}
                        readOnly={dependent.source === "OFFICIAL"}
                        aria-invalid={Boolean(dependentError)}
                        onChange={(event) =>
                          updateDependent(
                            dependent.id,
                            "inclusionDate",
                            event.target.value,
                          )
                        }
                        className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)] read-only:cursor-default read-only:opacity-75"
                      />
                      <p className="mt-1 text-xs text-[color:var(--app-muted)]">
                        {dependent.source === "OFFICIAL"
                          ? "Data da base; usa a inclusão do titular quando ausente."
                          : "Se ficar vazia, será usada a inclusão do titular."}
                      </p>
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
                      <div className="md:col-span-2 xl:col-span-4 flex justify-end">
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
                          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--app-danger-border)] px-3 text-xs font-black text-[color:var(--app-coral)] transition hover:bg-[color:var(--app-danger-soft)]"
                          aria-label={`Remover dependente ${index + 1}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Remover
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
