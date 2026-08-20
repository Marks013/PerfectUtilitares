"use client";

import type { useUnimedCalculationWorkspaceController } from "./unimed-calculation-workspace";

type Model = ReturnType<typeof useUnimedCalculationWorkspaceController>;

export function UnimedCalculationWorkspaceView({ model }: { model: Model }) {
  const { AlertCircle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, ArrowRight, Building2, Calculator, CircleDollarSign, FileText, Loader2, Mail, Printer, ResultMetric, RotateCcw, UnimedCalculationIdentificationSection, UnimedCalculationMovementSection, UnimedCalculationValuesSection, UnimedPrintSummary, apiError, blurDependentMoney, blurMoney, calculate, clearSelectedBeneficiary, dataCompetency, documentError, documentProgress, documentReady, documentRequired, emailConfirmed, emailDialogOpen, emailError, errors, form, formId, formatCompetencyResult, formatMoneyResult, generateDocument, includePayrollLoans, isCalculating, isGeneratingDocument, isSendingEmail, openGeneratedDocument, payrollLoans, reasons, resetWorkspace, result, selectBeneficiary, selectedBeneficiary, selectedReason, sendEmail, setEmailDialogOpen, updateDependent, updateExclusionDate, updateForm, updateHolder, updatePayrollLoansPrintPreference } = model;
  const activeError = apiError ?? documentError ?? emailError;
  return (
<div className="unimed-sheet-workspace">
      <header className="unimed-sheet-header border border-[color:var(--app-border)]">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Building2 className="size-6 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-black tracking-wide sm:text-2xl">
              CÁLCULO UNIMED
            </h1>
            <p className="text-xs font-semibold sm:text-sm">
              Ficha de exclusão, conferência financeira e documentos
            </p>
          </div>
        </div>
      </header>

      {activeError ? (
        <div
          className="mx-3 mt-3 flex items-start gap-3 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm text-[color:var(--app-fg)] sm:mx-5"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 size-5 shrink-0 text-[color:var(--app-coral)]"
            aria-hidden="true"
          />
          <p className="font-semibold leading-5">{activeError}</p>
        </div>
      ) : null}

      <div className="unimed-sheet-column-bar" aria-hidden="true">
        <span>COLABORADOR</span>
        <span>MOVIMENTO</span>
        <span>VALORES DO PLANO</span>
        <span>RESULTADO</span>
      </div>

      <form
        id={formId}
        onSubmit={calculate}
        noValidate
        className="unimed-sheet-form grid items-start xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]"
      >
        <div className="unimed-sheet-input-grid">
          <UnimedCalculationIdentificationSection
            form={form}
            errors={errors}
            selectedBeneficiary={selectedBeneficiary}
            selectBeneficiary={selectBeneficiary}
            clearSelectedBeneficiary={clearSelectedBeneficiary}
            updateForm={updateForm}
          />

          <UnimedCalculationMovementSection
            form={form}
            errors={errors}
            reasons={reasons}
            updateForm={updateForm}
            updateExclusionDate={updateExclusionDate}
          />

          <UnimedCalculationValuesSection
            form={form}
            errors={errors}
            selectedBeneficiary={selectedBeneficiary}
            updateForm={updateForm}
            updateHolder={updateHolder}
            blurMoney={blurMoney}
            updateDependent={updateDependent}
            blurDependentMoney={blurDependentMoney}
          />
        </div>

        <aside className="unimed-sheet-output-grid">
          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
                <Calculator className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  4. Resultado financeiro
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Resultado sempre exibido com duas casas decimais.
                </p>
              </div>
            </div>

            <div className="mt-4" aria-live="polite">
              {result ? (
                <div>
                  <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <ResultMetric
                      label="Estorno ao funcionário"
                      value={formatMoneyResult(result.employeeFullRefund)}
                      emphasis
                    />
                    <ResultMetric
                      label="Estorno à empresa"
                      value={formatMoneyResult(result.companyFullRefund)}
                      emphasis
                    />
                  </dl>
                  <div className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
                    <p className="text-xs font-black tracking-wide text-[color:var(--app-muted)] uppercase">
                      Memória do cálculo
                    </p>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-[color:var(--app-muted)]">
                          Proporcional de {formatCompetencyResult(result.currentCompetency)} ({result.refundDays} dias)
                        </dt>
                        <dd className="font-black text-[color:var(--app-fg)]">
                          {formatMoneyResult(result.currentCompetencyRefund)}
                        </dd>
                      </div>
                      {result.cutoffApplied && result.nextCompetency ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-[color:var(--app-muted)]">
                            Mensalidade de {formatCompetencyResult(result.nextCompetency)} ({result.nextCompetencyDays} dias)
                          </dt>
                          <dd className="font-black text-[color:var(--app-fg)]">
                            {formatMoneyResult(result.nextCompetencyRefund)}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3 border-t border-[color:var(--app-border)] pt-2">
                        <dt className="font-black text-[color:var(--app-fg)]">
                          Total estornado em fatura ({result.totalRefundDays} dias)
                        </dt>
                        <dd className="font-black text-[color:var(--app-fg)]">
                          {formatMoneyResult(result.invoiceRefund)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                      <span className="block text-xl font-black text-[color:var(--app-fg)]">
                        {result.totalRefundDays}
                      </span>
                      <span className="text-xs text-[color:var(--app-muted)]">
                        dias devolvidos em fatura
                      </span>
                    </div>
                    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                      <span className="block text-xl font-black text-[color:var(--app-fg)]">
                        {result.contributionMonths}
                      </span>
                      <span className="text-xs text-[color:var(--app-muted)]">
                        meses de contribuição
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-2.5 text-xs font-bold text-[color:var(--app-muted)]">
                    <FileText
                      className="size-4 shrink-0 text-[color:var(--app-gold)]"
                      aria-hidden="true"
                    />
                    Documento:{" "}
                    {result.documentKind === "RN561"
                      ? "RN561"
                      : result.documentKind === "INACTIVE_TERM"
                        ? "Termo de inativo"
                        : "não aplicável"}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-6 text-center">
                  <div>
                    <CircleDollarSign
                      className="mx-auto size-9 text-[color:var(--app-subtle)]"
                      aria-hidden="true"
                    />
                    <h3 className="mt-3 font-black text-[color:var(--app-fg)]">
                      Aguardando cálculo
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
                      Preencha identificação, regra e valores. Nenhum preço será
                      preenchido por suposição.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              <button
                type="submit"
                disabled={
                  isCalculating || isGeneratingDocument
                }
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-5 py-3 text-sm font-black text-[color:var(--app-action-text)] shadow-[0_14px_32px_rgba(20,184,166,0.22)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {isCalculating ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Calculator className="size-4" aria-hidden="true" />
                )}
                {result ? "Recalcular exclusão" : "Calcular exclusão"}
              </button>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-bold text-[color:var(--app-fg)]">
                <input
                  type="checkbox"
                  checked={includePayrollLoans}
                  onChange={(event) =>
                    updatePayrollLoansPrintPreference(event.target.checked)
                  }
                  className="size-4 shrink-0 accent-[color:var(--app-teal)]"
                />
                <span>Incluir Empréstimo Consignado no PDF</span>
              </label>
              <button
                type="button"
                onClick={resetWorkspace}
                disabled={isCalculating}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:opacity-50"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Limpar formulário
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!result || isCalculating}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-gold)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Printer className="size-4" aria-hidden="true" />
                Imprimir duas vias
              </button>
              <button
                type="button"
                onClick={() => {
                  if (documentReady) {
                    openGeneratedDocument();
                    return;
                  }
                  void generateDocument();
                }}
                disabled={
                  !result ||
                  !selectedBeneficiary ||
                  !documentRequired ||
                  isGeneratingDocument
                }
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isGeneratingDocument ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="size-4" aria-hidden="true" />
                )}
                {isGeneratingDocument
                  ? `Gerando PDF${documentProgress > 0 ? ` (${documentProgress}%)` : "…"}`
                  : documentReady
                    ? "Abrir PDF em nova aba"
                    : "Gerar documento obrigatório"}
              </button>
            </div>
          </section>

          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-coral)]">
                <Mail className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-black text-[color:var(--app-fg)]">
                  Solicitação de Coparticipação
                </h2>
                <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
                  Solicite a planilha de coparticipação para a rescisão. Nenhum
                  anexo será incluído automaticamente.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!result || !selectedBeneficiary || isSendingEmail}
              onClick={() => setEmailDialogOpen(true)}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-coral)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {emailConfirmed
                ? "Enviar e-mail novamente"
                : "Confirmar e enviar e-mail"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            {!result || !selectedBeneficiary ? (
              <p className="mt-2 text-center text-xs text-[color:var(--app-subtle)]">
                {!result
                  ? "Disponível após cálculo concluído."
                  : "Selecione um beneficiário na pesquisa para liberar o envio."}
              </p>
            ) : null}
          </section>
        </aside>
      </form>

      <AlertDialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <AlertDialogContent className="border-[color:var(--app-border)] bg-[color:var(--app-card)] text-[color:var(--app-fg)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[color:var(--app-fg)]">
              Confirmar envio do e-mail?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[color:var(--app-muted)]">
              Esta confirmação solicitará a planilha de coparticipação agora. O
              conteúdo terá nome e CPF, sem documento anexado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="mt-4 space-y-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Colaborador
              </dt>
              <dd className="mt-1 break-words text-sm font-black text-[color:var(--app-fg)]">
                {form.employeeName || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                CPF
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {form.cpf || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Motivo
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {selectedReason
                  ? `${selectedReason.code}. ${selectedReason.label}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Matrícula
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {selectedBeneficiary?.registration || "—"}
              </dd>
            </div>
          </dl>
          {emailError ? (
            <p
              className="mt-4 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm font-semibold text-[color:var(--app-fg)]"
              role="alert"
            >
              {emailError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isSendingEmail}
              className="min-h-10 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={sendEmail}
              disabled={isSendingEmail || !selectedBeneficiary || !result}
              className="min-h-10 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2 text-sm font-black text-[color:var(--app-action-text)]"
            >
              {isSendingEmail ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {isSendingEmail ? "Enviando…" : "Confirmar e enviar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnimedPrintSummary
        data={
          result
            ? {
                employeeName: form.employeeName,
                cpf: form.cpf,
                registration: selectedBeneficiary?.registration,
                reasonCode: Number(form.reasonCode),
                reason: selectedReason
                  ? `${selectedReason.code}. ${selectedReason.label}`
                  : "",
                competency: dataCompetency
                  ? `${dataCompetency.year}-${String(
                      dataCompetency.month,
                    ).padStart(2, "0")}`
                  : form.exclusionDate.slice(0, 7),
                exclusionDate: form.exclusionDate,
                planEnrollmentDate: form.planEnrollmentDate,
                billingClosure: form.billingClosure,
                branchCode:
                  selectedBeneficiary?.branch?.name ??
                  selectedBeneficiary?.branch?.code ??
                  null,
                holder: {
                  id: selectedBeneficiary?.id ?? "holder",
                  registration: selectedBeneficiary?.registration ?? null,
                  name: form.employeeName,
                  birthDate: selectedBeneficiary?.birthDate ?? null,
                  age: selectedBeneficiary?.pricing.age ?? null,
                  planCode: selectedBeneficiary?.planCode ?? null,
                  hasFuneral: selectedBeneficiary?.hasAddon ?? false,
                  invoicePlanAmount: form.holder.invoicePlanAmount,
                  payrollPlanAmount: form.holder.payrollPlanAmount,
                  funeralAmount: form.holder.addonAmount,
                },
                dependents: form.dependents.map((dependent) => ({
                  id: dependent.id,
                  selected: dependent.selected,
                  registration: null,
                  name: dependent.name,
                  birthDate: dependent.birthDate,
                  age: dependent.age,
                  planCode: dependent.planCode,
                  hasFuneral: dependent.hasAddon,
                  invoicePlanAmount: dependent.invoicePlanAmount,
                  payrollPlanAmount: null,
                  funeralAmount: dependent.addonAmount,
                })),
                includePayrollLoans,
                payrollLoans,
                result,
              }
            : null
        }
      />
    </div>
  );
}
