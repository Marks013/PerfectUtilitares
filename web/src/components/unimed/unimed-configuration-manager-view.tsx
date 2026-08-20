"use client";

import type { useUnimedConfigurationManagerController } from "./unimed-configuration-manager";
import type { ReasonForm } from "./unimed-configuration-manager-model";
import { UnimedConfigurationPriceHistory } from "./unimed-configuration-manager-price-history";
import { UnimedConfigurationPlansSection } from "./unimed-configuration-manager-unimed-configuration-plans-section";
import { UnimedExcelDevices } from "./unimed-excel-devices";

type Model = ReturnType<typeof useUnimedConfigurationManagerController>;

export function UnimedConfigurationManagerView({ model }: { model: Model }) {
  const { loading, CalendarRange, CircleDollarSign, Clock3, ConfigFieldContext, ConfigSection, DEFAULT_UNIMED_EMAIL_SUBJECT, DecimalInput, FieldLabel, FileCog, Loader2, Mail, Plus, RefreshCw, Save, SectionHeading, Settings2, TextInput, Trash2, UnimedNoticeToast, bracketOptions, clearFieldError, feedback, fieldErrors, form, loadConfiguration, newAddonPrice, newPlanPrice, newReason, saveConfiguration, saving, setFeedback, setForm, updateAddon, updatePlan, updateReason } = model;
  if (loading) {
    return (
<div className="grid min-h-[30rem] place-items-center" role="status">
        <div className="text-center">
          <Loader2
            className="mx-auto size-8 animate-spin text-[color:var(--app-teal)]"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-black text-[color:var(--app-fg)]">
            Carregando configurações…
          </p>
        </div>
      </div>
    );
  }

  return (
<ConfigFieldContext.Provider
      value={{ errors: fieldErrors, clear: clearFieldError }}
    >
      <div className="space-y-6">
        <header className="rounded-(--app-radius-lg) border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-1.5 text-xs font-black tracking-wide text-[color:var(--app-teal)] uppercase">
                <Settings2 className="size-3.5" aria-hidden="true" />
                Unimed · Administração
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-[color:var(--app-fg)] sm:text-4xl">
                Configurações e valores
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)] sm:text-base">
                O sistema mantém a tabela ativa e a competência anterior.
                Valores financeiros usam duas casas decimais.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadConfiguration()}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Recarregar
            </button>
          </div>
        </header>

        <UnimedNoticeToast
          notice={
            feedback
              ? {
                  id:
                    feedback.type === "success"
                      ? "config-success"
                      : "config-error",
                  type: feedback.type,
                  title:
                    feedback.type === "success"
                      ? "Configuração atualizada"
                      : "Não foi possível salvar",
                  message:
                    feedback.type === "success"
                      ? feedback.message
                      : feedback.messages.join(" "),
                }
              : null
          }
          onClose={() => setFeedback(null)}
        />

        <nav
          aria-label="Seções das configurações"
          className="sticky top-2 z-10 grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-2 shadow-[var(--app-shadow)] sm:grid-cols-3 lg:grid-cols-7"
        >
          {[
            ["config-calculation-section", "Vigência"],
            ["config-price-history-section", "Competências"],
            ["config-age-brackets-section", "Faixas e valores"],
            ["config-addons-section", "Adicionais"],
            ["config-reasons-section", "Motivos"],
            ["config-email-section", "E-mail"],
            ["config-excel-section", "Planilha"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={`#${href}`}
              onClick={() => {
                const section = document.getElementById(href);
                if (section instanceof HTMLDetailsElement) section.open = true;
              }}
              className="flex min-h-10 min-w-0 items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-black text-[color:var(--app-fg)] transition hover:bg-[color:var(--app-surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <ConfigSection
          id="config-calculation-section"
          icon={CalendarRange}
          title="Vigência e cálculo"
          description="Define quando esta versão entra em vigor e os percentuais aplicados."
          defaultOpen
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <FieldLabel htmlFor="config-valid-from">
                Início da vigência *
              </FieldLabel>
              <TextInput
                id="config-valid-from"
                type="date"
                value={form.validFrom}
                onChange={(validFrom) => {
                  setForm((current) => ({ ...current, validFrom }));
                  setFeedback(null);
                }}
              />
            </div>
            <div>
              <FieldLabel htmlFor="config-closure">
                Fechamento da fatura *
              </FieldLabel>
              <select
                id="config-closure"
                value={form.billingClosure}
                onChange={(event) => {
                  clearFieldError("config-closure");
                  setForm((current) => ({
                    ...current,
                    billingClosure: event.target.value as
                      "" | "OPEN" | "AUTOMATIC_DAY_25",
                  }));
                  setFeedback(null);
                }}
                aria-invalid={Boolean(fieldErrors["config-closure"])}
                aria-describedby={
                  fieldErrors["config-closure"]
                    ? "config-closure-error"
                    : undefined
                }
                className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors["config-closure"] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
              >
                <option value="">Selecione</option>
                <option value="OPEN">Fatura aberta</option>
                <option value="AUTOMATIC_DAY_25">
                  Fechamento automático no dia 25
                </option>
              </select>
              {fieldErrors["config-closure"] ? (
                <p
                  id="config-closure-error"
                  className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                  role="alert"
                >
                  {fieldErrors["config-closure"]}
                </p>
              ) : null}
            </div>
            <div>
              <FieldLabel htmlFor="config-adjustment">
                Reajuste anual *
              </FieldLabel>
              <DecimalInput
                id="config-adjustment"
                prefix="%"
                value={form.annualAdjustmentPercent}
                onChange={(annualAdjustmentPercent) =>
                  setForm((current) => ({
                    ...current,
                    annualAdjustmentPercent,
                  }))
                }
              />
            </div>
            <div>
              <FieldLabel htmlFor="config-difference">
                Diferença de cálculo *
              </FieldLabel>
              <DecimalInput
                id="config-difference"
                prefix="%"
                value={form.differencePercent}
                onChange={(differencePercent) =>
                  setForm((current) => ({ ...current, differencePercent }))
                }
              />
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-3 text-xs leading-5 text-[color:var(--app-fg)]">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Ao salvar nova vigência, a anterior termina no dia precedente e
            apenas as duas competências mais recentes são mantidas.
          </div>
        </ConfigSection>

        <UnimedConfigurationPriceHistory model={model} />

        <UnimedConfigurationPlansSection model={model} />

        <section className="hidden rounded-(--app-radius-lg) border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <SectionHeading
              icon={CircleDollarSign}
              title="Preços do plano"
              description="Parcela da empresa e do colaborador por plano e faixa."
            />
            <button
              type="button"
              disabled={bracketOptions.length === 0}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  planPrices: [
                    ...current.planPrices,
                    newPlanPrice(bracketOptions[0]?.code ?? ""),
                  ],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-45"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar preço
            </button>
          </div>
          {form.planPrices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Cadastre faixa etária e depois inclua preços reais.
            </p>
          ) : (
            <div className="space-y-3">
              {form.planPrices.map((price, index) => (
                <div
                  key={price.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`plan-code-${price.localId}`}>
                      Código/nome do plano
                    </FieldLabel>
                    <TextInput
                      id={`plan-code-${price.localId}`}
                      value={price.planCode}
                      onChange={(value) =>
                        updatePlan(price.localId, "planCode", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-age-${price.localId}`}>
                      Faixa etária
                    </FieldLabel>
                    <select
                      id={`plan-age-${price.localId}`}
                      value={price.ageBracketCode}
                      onChange={(event) =>
                        updatePlan(
                          price.localId,
                          "ageBracketCode",
                          event.target.value,
                        )
                      }
                      className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)]"
                    >
                      <option value="">Selecione</option>
                      {bracketOptions.map((bracket) => (
                        <option key={bracket.localId} value={bracket.code}>
                          {bracket.label || bracket.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-company-${price.localId}`}>
                      Empresa
                    </FieldLabel>
                    <DecimalInput
                      id={`plan-company-${price.localId}`}
                      value={price.companyAmount}
                      onChange={(value) =>
                        updatePlan(price.localId, "companyAmount", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-employee-${price.localId}`}>
                      Colaborador
                    </FieldLabel>
                    <DecimalInput
                      id={`plan-employee-${price.localId}`}
                      value={price.employeeAmount}
                      onChange={(value) =>
                        updatePlan(price.localId, "employeeAmount", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          planPrices: current.planPrices.filter(
                            (item) => item.localId !== price.localId,
                          ),
                        }))
                      }
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover preço ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <ConfigSection
          id="config-addons-section"
          icon={FileCog}
          title="Adicionais"
          description="Valores extras opcionais vinculados ao plano."
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  addonPrices: [...current.addonPrices, newAddonPrice()],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar
            </button>
          </div>
          {form.addonPrices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Nenhum adicional configurado.
            </p>
          ) : (
            <div className="space-y-3">
              {form.addonPrices.map((price, index) => (
                <div
                  key={price.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1.5fr_1fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`addon-code-${price.localId}`}>
                      Código
                    </FieldLabel>
                    <TextInput
                      id={`addon-code-${price.localId}`}
                      value={price.code}
                      onChange={(value) =>
                        updateAddon(price.localId, "code", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`addon-label-${price.localId}`}>
                      Nome
                    </FieldLabel>
                    <TextInput
                      id={`addon-label-${price.localId}`}
                      value={price.label}
                      onChange={(value) =>
                        updateAddon(price.localId, "label", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`addon-amount-${price.localId}`}>
                      Valor
                    </FieldLabel>
                    <DecimalInput
                      id={`addon-amount-${price.localId}`}
                      value={price.amount}
                      onChange={(value) =>
                        updateAddon(price.localId, "amount", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          addonPrices: current.addonPrices.filter(
                            (item) => item.localId !== price.localId,
                          ),
                        }))
                      }
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover adicional ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConfigSection>

        <ConfigSection
          id="config-reasons-section"
          icon={FileCog}
          title="Motivos de rescisão"
          description="Renomeie, adicione ou exclua motivos e vincule o documento obrigatório."
          className={
            fieldErrors["config-reasons-section"]
              ? "!border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]"
              : ""
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  reasons: [...current.reasons, newReason(current.reasons)],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar motivo
            </button>
          </div>
          {fieldErrors["config-reasons-section"] ? (
            <p
              className="mb-4 text-xs font-bold text-[color:var(--app-coral)]"
              role="alert"
            >
              {fieldErrors["config-reasons-section"]}
            </p>
          ) : null}
          <div className="space-y-3">
            {form.reasons.map((reason, index) => (
              <div
                key={reason.localId}
                className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-[0.45fr_1.5fr_1fr_auto]"
              >
                <div>
                  <FieldLabel htmlFor={`reason-code-${reason.localId}`}>
                    Código
                  </FieldLabel>
                  <TextInput
                    id={`reason-code-${reason.localId}`}
                    value={reason.code}
                    onChange={() => undefined}
                    disabled
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`reason-label-${reason.localId}`}>
                    Motivo
                  </FieldLabel>
                  <TextInput
                    id={`reason-label-${reason.localId}`}
                    value={reason.label}
                    onChange={(value) =>
                      updateReason(reason.localId, "label", value)
                    }
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`reason-document-${reason.localId}`}>
                    Documento obrigatório
                  </FieldLabel>
                  <select
                    id={`reason-document-${reason.localId}`}
                    value={reason.documentKind}
                    onChange={(event) => {
                      clearFieldError(`reason-document-${reason.localId}`);
                      updateReason(
                        reason.localId,
                        "documentKind",
                        event.target.value as ReasonForm["documentKind"],
                      );
                    }}
                    aria-invalid={Boolean(
                      fieldErrors[`reason-document-${reason.localId}`],
                    )}
                    aria-describedby={
                      fieldErrors[`reason-document-${reason.localId}`]
                        ? `reason-document-${reason.localId}-error`
                        : undefined
                    }
                    className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors[`reason-document-${reason.localId}`] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)]"}`}
                  >
                    <option value="NONE">Nenhum</option>
                    <option value="RN561">Formulário RN561</option>
                    <option value="INACTIVE_TERM">Termo de inativo</option>
                  </select>
                  {fieldErrors[`reason-document-${reason.localId}`] ? (
                    <p
                      id={`reason-document-${reason.localId}-error`}
                      className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                      role="alert"
                    >
                      {fieldErrors[`reason-document-${reason.localId}`]}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        reasons: current.reasons.filter(
                          (item) => item.localId !== reason.localId,
                        ),
                      }))
                    }
                    disabled={form.reasons.length <= 1}
                    className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Excluir motivo ${index + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </ConfigSection>

        <ConfigSection
          id="config-email-section"
          icon={Mail}
          title="E-mail"
          description="Destinatários fixos e assunto padrão. Nenhum endereço é presumido."
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  emailEnabled: event.target.checked,
                }))
              }
              className="mt-1 size-4"
            />
            <span>
              <span className="block text-sm font-black text-[color:var(--app-fg)]">
                Habilitar envio de e-mail
              </span>
              <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
                O cálculo continua funcionando quando envio estiver
                desabilitado.
              </span>
            </span>
          </label>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="config-email-recipients">
                Destinatários *
              </FieldLabel>
              <textarea
                id="config-email-recipients"
                rows={5}
                value={form.emailRecipients}
                placeholder={"um@email.com\noutro@email.com"}
                onChange={(event) => {
                  clearFieldError("config-email-recipients");
                  setForm((current) => ({
                    ...current,
                    emailRecipients: event.target.value,
                  }));
                }}
                aria-invalid={Boolean(fieldErrors["config-email-recipients"])}
                aria-describedby={
                  fieldErrors["config-email-recipients"]
                    ? "config-email-recipients-error"
                    : undefined
                }
                className={`w-full resize-y rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors["config-email-recipients"] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
              />
              {fieldErrors["config-email-recipients"] ? (
                <p
                  id="config-email-recipients-error"
                  className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                  role="alert"
                >
                  {fieldErrors["config-email-recipients"]}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-[color:var(--app-fg)]">
                Um por linha, ou separados por vírgula.
              </p>
            </div>
            <div>
              <FieldLabel htmlFor="config-email-subject">
                Assunto padrão *
              </FieldLabel>
              <TextInput
                id="config-email-subject"
                value={DEFAULT_UNIMED_EMAIL_SUBJECT}
                onChange={() => undefined}
                disabled
              />
              <p className="mt-2 text-xs text-[color:var(--app-fg)]">
                O primeiro envio do dia usa este assunto. Os seguintes recebem
                pontos automáticos para o Gmail não agrupá-los.
              </p>
            </div>
          </div>
        </ConfigSection>

        <UnimedExcelDevices />

        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-shell)] p-4 shadow-[var(--app-shell-shadow)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-[color:var(--app-muted)]">
            Salvar cria ou atualiza versão da vigência informada.
          </p>
          <button
            type="button"
            onClick={() => void saveConfiguration()}
            disabled={saving}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-6 py-3 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {saving ? "Salvando…" : "Salvar configurações"}
          </button>
        </div>
      </div>
    </ConfigFieldContext.Provider>
  );
}
