"use client";

import type { useUnimedConfigurationManagerController } from "./unimed-configuration-manager";

type Model = ReturnType<typeof useUnimedConfigurationManagerController>;

export function UnimedConfigurationPlansSection({ model }: { model: Model }) {
  const { ConfigSection, DecimalInput, FieldLabel, Plus, TextInput, Trash2, UsersRound, fieldErrors, form, newAgeBracket, newPlanPrice, setForm, updateAge, updatePlan } = model;
  return (
<ConfigSection
          id="config-age-brackets-section"
          icon={UsersRound}
          title="Faixas etárias e valores"
          description="Uma única tabela de preço atende todos os códigos de plano."
          className={
            fieldErrors["config-age-brackets-section"]
              ? "!border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]"
              : ""
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => {
                  const bracket = newAgeBracket(current.ageBrackets.length);
                  return {
                    ...current,
                    ageBrackets: [...current.ageBrackets, bracket],
                    planPrices: [
                      ...current.planPrices,
                      newPlanPrice(bracket.code),
                    ],
                  };
                })
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar faixa
            </button>
          </div>
          {fieldErrors["config-age-brackets-section"] ? (
            <p
              className="mb-4 text-xs font-bold text-[color:var(--app-coral)]"
              role="alert"
            >
              {fieldErrors["config-age-brackets-section"]}
            </p>
          ) : null}
          {form.ageBrackets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Nenhuma faixa cadastrada. Valores permanecem vazios até inclusão.
            </p>
          ) : (
            <div className="space-y-3">
              {form.ageBrackets.map((bracket, index) => (
                <div
                  key={bracket.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-2 xl:grid-cols-[0.7fr_1.2fr_0.55fr_0.55fr_0.55fr_0.8fr_0.8fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`age-code-${bracket.localId}`}>
                      Código
                    </FieldLabel>
                    <TextInput
                      id={`age-code-${bracket.localId}`}
                      value={bracket.code}
                      onChange={(value) =>
                        updateAge(bracket.localId, "code", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-company-${bracket.localId}`}>
                      Valor fatura
                    </FieldLabel>
                    <DecimalInput
                      id={`age-company-${bracket.localId}`}
                      value={
                        form.planPrices.find(
                          (price) => price.ageBracketCode === bracket.code,
                        )?.companyAmount ?? ""
                      }
                      onChange={(value) => {
                        const price = form.planPrices.find(
                          (item) => item.ageBracketCode === bracket.code,
                        );
                        if (price)
                          updatePlan(price.localId, "companyAmount", value);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-employee-${bracket.localId}`}>
                      Valor titular
                    </FieldLabel>
                    <DecimalInput
                      id={`age-employee-${bracket.localId}`}
                      value={
                        form.planPrices.find(
                          (price) => price.ageBracketCode === bracket.code,
                        )?.employeeAmount ?? ""
                      }
                      onChange={(value) => {
                        const price = form.planPrices.find(
                          (item) => item.ageBracketCode === bracket.code,
                        );
                        if (price)
                          updatePlan(price.localId, "employeeAmount", value);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-label-${bracket.localId}`}>
                      Nome
                    </FieldLabel>
                    <TextInput
                      id={`age-label-${bracket.localId}`}
                      value={bracket.label}
                      onChange={(value) =>
                        updateAge(bracket.localId, "label", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-min-${bracket.localId}`}>
                      Idade mín.
                    </FieldLabel>
                    <TextInput
                      id={`age-min-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      value={bracket.minAge}
                      onChange={(value) =>
                        updateAge(bracket.localId, "minAge", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-max-${bracket.localId}`}>
                      Idade máx.
                    </FieldLabel>
                    <TextInput
                      id={`age-max-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      placeholder="Sem limite"
                      value={bracket.maxAge}
                      onChange={(value) =>
                        updateAge(bracket.localId, "maxAge", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-order-${bracket.localId}`}>
                      Ordem
                    </FieldLabel>
                    <TextInput
                      id={`age-order-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      value={bracket.sortOrder}
                      onChange={(value) =>
                        updateAge(bracket.localId, "sortOrder", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        const removedCode = bracket.code;
                        setForm((current) => ({
                          ...current,
                          ageBrackets: current.ageBrackets.filter(
                            (item) => item.localId !== bracket.localId,
                          ),
                          planPrices: current.planPrices.filter(
                            (price) => price.ageBracketCode !== removedCode,
                          ),
                        }));
                      }}
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover faixa ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConfigSection>
  );
}
