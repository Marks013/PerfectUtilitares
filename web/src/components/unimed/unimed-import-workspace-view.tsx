"use client";

import type { useUnimedImportWorkspaceController } from "./unimed-import-workspace";

type Model = ReturnType<typeof useUnimedImportWorkspaceController>;

export function UnimedImportWorkspaceView({ model }: { model: Model }) {
  const { AlertCircle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Archive, CalendarDays, CheckCircle2, Database, FileGroup, FileSpreadsheet, FileText, Loader2, LockKeyhole, RotateCcw, ShieldCheck, SummaryMetric, UsersRound, addressFiles, addressInputRef, baseBytes, baseFiles, beneficiaryFiles, beneficiaryInputRef, bytesLabel, competency, confirmationTarget, fileKey, invoiceFiles, invoiceInputRef, isBusy, isPayrollLoanBusy, masterFiles, masterInputRef, mergeFiles, payrollLoanBytes, payrollLoanFiles, payrollLoanInputRef, payrollLoanState, publishBase, publishPayrollLoan, requestConfirmation, reset, selectedBaseSources, selectedMonthLabel, setAddressFiles, setBeneficiaryFiles, setCompetency, setConfirmationTarget, setInvoiceFiles, setMasterFiles, setPayrollLoanFiles, setPayrollLoanState, setState, state } = model;
  return (
<div className="space-y-6">
      <header className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-1.5 text-xs font-black tracking-wide text-[color:var(--app-teal)] uppercase">
              <Database className="size-3.5" aria-hidden="true" />
              Unimed · Base mensal
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[color:var(--app-fg)] sm:text-4xl">
              Importar dados por competência
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)] sm:text-base">
              Use a planilha mestre para atualizar beneficiários, faturas e
              endereços juntos. Fontes separadas continuam disponíveis.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-4 lg:max-w-sm">
            <LockKeyhole
              className="mt-0.5 size-5 shrink-0 text-[color:var(--app-teal)]"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-[color:var(--app-fg)]">
              Originais ficam somente nesta seleção e na requisição ativa. Após
              resposta, referências locais são liberadas.
            </p>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-gold)]">
                <CalendarDays className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  Competência
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Mês que será validado e publicado.
                </p>
              </div>
            </div>
            <label
              htmlFor="unimed-import-competency"
              className="mt-5 block text-sm font-bold text-[color:var(--app-fg)]"
            >
              Mês e ano
              <span className="ml-1 text-[color:var(--app-coral)]">*</span>
            </label>
            <input
              id="unimed-import-competency"
              type="month"
              min="2020-01"
              max="2100-12"
              value={competency}
              disabled={isBusy}
              onChange={(event) => {
                setCompetency(event.target.value);
                if (state.status === "error") {
                  setState({ status: "idle", progress: 0 });
                }
                if (payrollLoanState.status === "error") {
                  setPayrollLoanState({ status: "idle", progress: 0 });
                }
              }}
              className="mt-2 min-h-11 w-full max-w-xs rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-bold text-[color:var(--app-fg)] focus:border-[color:var(--app-teal)] disabled:opacity-50"
            />
          </section>

          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                Arquivos de origem
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                Prefira CALCULO UNIMED.xlsm. Alternativamente, envie as fontes
                separadas. Máximo de 10 MB por arquivo e 20 MB no conjunto.
              </p>
              <p className="mt-2 text-xs font-semibold text-[color:var(--app-gold)]">
                Planilha mestre e fontes separadas não podem ser combinadas na
                mesma publicação.
              </p>
            </div>
            <div
              className={`grid gap-4 lg:grid-cols-2 ${
                isBusy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <div className="lg:col-span-2">
                <FileGroup
                  id="unimed-master-workbook"
                  title="Planilha mestre"
                  description="CALCULO UNIMED.xlsm com as abas Unimed, Fatura e Endereço. Macros e conexões externas nunca são executadas."
                  accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  multiple={false}
                  files={masterFiles}
                  inputRef={masterInputRef}
                  onFiles={(files) => {
                    setMasterFiles(files.slice(0, 1));
                    setBeneficiaryFiles([]);
                    setInvoiceFiles([]);
                    setAddressFiles([]);
                  }}
                  onRemove={() => setMasterFiles([])}
                  icon={FileSpreadsheet}
                />
              </div>
              <FileGroup
                id="unimed-beneficiary-files"
                title="Beneficiários"
                description="Cadastro: deve conter CODIGO, NOME, DATA DE NASCIMENTO, DATA DE INCLUSAO e CNPJ."
                accept=".csv,text/csv"
                multiple
                files={beneficiaryFiles}
                inputRef={beneficiaryInputRef}
                onFiles={(files) => {
                  setMasterFiles([]);
                  setBeneficiaryFiles((current) => mergeFiles(current, files));
                }}
                onRemove={(key) =>
                  setBeneficiaryFiles((current) =>
                    current.filter((file) => fileKey(file) !== key),
                  )
                }
                icon={UsersRound}
              />
              <FileGroup
                id="unimed-invoice-files"
                title="Faturas"
                description="Coparticipação: deve conter CONTRATO, CARTAO, BENEFICIARIO, ITEM e VALOR."
                accept=".csv,text/csv"
                multiple
                files={invoiceFiles}
                inputRef={invoiceInputRef}
                onFiles={(files) => {
                  setMasterFiles([]);
                  setInvoiceFiles((current) => mergeFiles(current, files));
                }}
                onRemove={(key) =>
                  setInvoiceFiles((current) =>
                    current.filter((file) => fileKey(file) !== key),
                  )
                }
                icon={FileText}
              />
              <div className="lg:col-span-2">
                <FileGroup
                  id="unimed-address-file"
                  title="Endereços"
                  description="Uma única planilha XLSX com a base de endereços."
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  multiple={false}
                  files={addressFiles}
                  inputRef={addressInputRef}
                  onFiles={(files) => {
                    setMasterFiles([]);
                    setAddressFiles(files.slice(0, 1));
                  }}
                  onRemove={() => setAddressFiles([])}
                  icon={FileSpreadsheet}
                />
              </div>
            </div>
          </section>

          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                Empréstimo Consignado
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                Importação independente por competência. Use preferencialmente o
                arquivo bruto, na aba Planilha1. A aba GERAL também é aceita
                quando contém todos os campos essenciais.
              </p>
            </div>
            <div className={isBusy ? "pointer-events-none opacity-60" : ""}>
              <FileGroup
                id="unimed-payroll-loan-file"
                title="Planilha de consignados"
                description="Uma planilha XLSX, com até 10 MB. O vínculo prioriza o CPF e usa a matrícula somente como alternativa segura."
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple={false}
                files={payrollLoanFiles}
                inputRef={payrollLoanInputRef}
                onFiles={(files) => setPayrollLoanFiles(files.slice(0, 1))}
                onRemove={() => setPayrollLoanFiles([])}
                icon={FileSpreadsheet}
              />
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[color:var(--app-muted)]">
                A importação substitui somente os consignados da competência
                selecionada.
              </p>
              <button
                type="button"
                onClick={() => requestConfirmation("payrollLoan")}
                disabled={isBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2.5 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
              >
                {isPayrollLoanBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Importar consignados
              </button>
            </div>

            {payrollLoanState.status === "uploading" ||
            payrollLoanState.status === "processing" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-sm font-black text-[color:var(--app-fg)]">
                  <Loader2 className="size-4 animate-spin text-[color:var(--app-teal)]" />
                  {payrollLoanState.status === "uploading"
                    ? `${payrollLoanState.progress}% enviado`
                    : "Validando e vinculando contratos"}
                </div>
              </div>
            ) : null}

            {payrollLoanState.status === "error" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-4"
                role="alert"
              >
                <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
                  <AlertCircle className="size-4 text-[color:var(--app-coral)]" />
                  Consignados não importados
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--app-muted)]">
                  {payrollLoanState.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {payrollLoanState.status === "success" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
                  <CheckCircle2 className="size-5 text-[color:var(--app-lime)]" />
                  {payrollLoanState.result.idempotent
                    ? "Consignados já estavam atualizados"
                    : "Consignados importados"}
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Contratos
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.payrollLoans.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Total das parcelas
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.totalInstallmentAmount.toLocaleString(
                        "pt-BR",
                        { style: "currency", currency: "BRL" },
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Aba processada
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.sourceSheet}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Vínculos por CPF
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.matchedByCpf.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Vínculos por matrícula
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.matchedByRegistration.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Sem vínculo
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.unmatched.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                </dl>
                {payrollLoanState.result.summary.warnings > 0 ? (
                  <p className="mt-3 text-xs font-bold text-[color:var(--app-gold)]">
                    {payrollLoanState.result.summary.warnings.toLocaleString(
                      "pt-BR",
                    )}{" "}
                    alerta(s) de validação.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-32">
          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]">
            <h2 className="font-black text-[color:var(--app-fg)]">
              Resumo da seleção
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">Competência</dt>
                <dd className="font-black text-[color:var(--app-fg)]">
                  {selectedMonthLabel(competency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">
                  CSVs beneficiários
                </dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {beneficiaryFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">CSVs faturas</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {invoiceFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">XLSX endereço</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {addressFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-[color:var(--app-border)] pt-3">
                <dt className="text-[color:var(--app-muted)]">Tamanho total</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {bytesLabel(baseBytes)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => requestConfirmation("base")}
                disabled={isBusy}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-3 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
              >
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Importar fontes selecionadas
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)]"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Limpar
              </button>
            </div>
          </section>

          {state.status === "uploading" || state.status === "processing" ? (
            <section
              className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  className="size-5 animate-spin text-[color:var(--app-teal)]"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-sm font-black text-[color:var(--app-fg)]">
                    {state.status === "uploading"
                      ? "Enviando arquivos"
                      : "Validando e conciliando"}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--app-muted)]">
                    {state.status === "uploading"
                      ? `${state.progress}% enviado`
                      : "Publicação transacional em andamento."}
                  </p>
                </div>
              </div>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-[color:var(--app-surface-strong)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.progress}
              >
                <div
                  className={`h-full rounded-full bg-[color:var(--app-teal)] transition-[width] ${
                    state.status === "processing" ? "animate-pulse" : ""
                  }`}
                  style={{ width: `${state.progress}%` }}
                />
              </div>
            </section>
          ) : null}

          {state.status === "error" ? (
            <section
              className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-5"
              role="alert"
            >
              <AlertCircle
                className="size-6 text-[color:var(--app-coral)]"
                aria-hidden="true"
              />
              <h2 className="mt-3 font-black text-[color:var(--app-fg)]">
                Importação não publicada
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-[color:var(--app-muted)]">
                {state.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {state.status === "success" ? (
        <section
          className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-success-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="size-8 shrink-0 text-[color:var(--app-lime)]"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-xl font-black text-[color:var(--app-fg)]">
                {state.result.idempotent
                  ? "Competência já estava publicada"
                  : state.result.ready
                    ? "Competência pronta para uso"
                    : "Fontes importadas com sucesso"}
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                {state.result.ready
                  ? "A competência contém todas as fontes necessárias."
                  : "A competência foi preservada como incompleta e ainda não substitui a base ativa."}{" "}
                Arquivos originais liberados da memória do formulário.
              </p>
            </div>
          </div>
          {!state.result.ready && state.result.missingSources.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4 text-sm text-[color:var(--app-muted)]">
              <div className="font-black text-[color:var(--app-fg)]">
                Fontes ainda necessárias
              </div>
              <p className="mt-1">
                {state.result.missingSources.join(", ")}. Importe cada fonte
                quando estiver disponível; os dados já enviados foram mantidos.
              </p>
            </div>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryMetric
              label="beneficiários"
              value={state.result.summary.beneficiaries}
            />
            <SummaryMetric
              label="itens de fatura"
              value={state.result.summary.invoiceItems}
            />
            <SummaryMetric
              label="endereços"
              value={state.result.summary.addresses}
            />
            <SummaryMetric
              label="lojas"
              value={state.result.summary.branches}
            />
            <SummaryMetric
              label="linhas ignoradas"
              value={state.result.summary.skippedRows}
            />
          </div>
          <div className="mt-4 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4">
            <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
              <Archive className="size-4" aria-hidden="true" />
              Alertas de conciliação
            </div>
            <ul className="mt-2 grid gap-1 text-sm text-[color:var(--app-muted)] sm:grid-cols-3">
              <li>
                Faturas sem vínculo:{" "}
                {state.result.summary.warnings.unmatchedInvoiceItems}
              </li>
              <li>
                Dependentes sem vínculo:{" "}
                {state.result.summary.warnings.unmatchedDependents}
              </li>
              <li>
                Planos ambíguos:{" "}
                {state.result.summary.warnings.ambiguousPlanCodes}
              </li>
            </ul>
            {(state.result.summary.warningDetails?.unmatchedInvoiceItems
              .length ?? 0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver faturas sem vínculo
                </summary>
                <p className="mt-2">
                  Estes itens possuem CPF na fatura, mas o CPF não existe na
                  base de beneficiários. O sistema não força associação por nome
                  ou matrícula para evitar vínculo incorreto.
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                  {state.result.summary.warningDetails?.unmatchedInvoiceItems.map(
                    (item) => (
                      <li key={item.sourceKey}>
                        {item.sourceKey} · {item.branchCode} ·{" "}
                        {item.beneficiaryName} · {item.itemDescription}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
            {(state.result.summary.warningDetails?.unmatchedDependents.length ??
              0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver dependentes sem titular seguro
                </summary>
                <ul className="mt-2 space-y-1">
                  {state.result.summary.warningDetails?.unmatchedDependents.map(
                    (item) => (
                      <li key={item.sourceKey}>
                        {item.branchCode} · {item.fullName} · sem referência de
                        titular na fatura
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
            {(state.result.summary.warningDetails?.ambiguousPlanCodes.length ??
              0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver planos realmente ambíguos
                </summary>
                <ul className="mt-2 space-y-1">
                  {state.result.summary.warningDetails?.ambiguousPlanCodes.map(
                    (item) => (
                      <li key={item.sourceKey}>
                        {item.branchCode} · {item.fullName} ·{" "}
                        {item.planCodes.join(" / ")}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
          </div>
          <div className="mt-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 text-sm text-[color:var(--app-muted)]">
            <div className="font-black text-[color:var(--app-fg)]">
              Banco de endereços complementar
            </div>
            <p className="mt-1">
              {state.result.summary.information.addressOnlyRows} registros
              existem somente no banco de endereços e foram ignorados. Eles não
              criam plano, cobrança ou beneficiário. O CPF faz a correlação
              prioritária; após o vínculo, a matrícula do banco de endereços é
              usada para facilitar a pesquisa do colaborador.
            </p>
          </div>
        </section>
      ) : null}

      <AlertDialog
        open={confirmationTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmationTarget(null);
        }}
      >
        <AlertDialogContent className="border-[color:var(--app-border)] bg-[color:var(--app-card)] text-[color:var(--app-fg)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[color:var(--app-fg)]">
              {confirmationTarget === "payrollLoan"
                ? "Importar empréstimos consignados"
                : "Importar fontes selecionadas"}{" "}
              em {selectedMonthLabel(competency)}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[color:var(--app-muted)]">
              {confirmationTarget === "payrollLoan"
                ? "Os contratos da competência serão substituídos somente após a validação completa da planilha. As demais fontes não serão alteradas."
                : "Somente as fontes indicadas abaixo serão substituídas. Se a competência ainda estiver incompleta, ela será preservada sem substituir a base ativa."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 text-sm">
            <div>
              <dt className="text-xs text-[color:var(--app-subtle)]">
                Arquivos
              </dt>
              <dd className="mt-1 font-black text-[color:var(--app-fg)]">
                {confirmationTarget === "payrollLoan"
                  ? payrollLoanFiles.length
                  : baseFiles.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[color:var(--app-subtle)]">
                Tamanho
              </dt>
              <dd className="mt-1 font-black text-[color:var(--app-fg)]">
                {bytesLabel(
                  confirmationTarget === "payrollLoan"
                    ? payrollLoanBytes
                    : baseBytes,
                )}
              </dd>
            </div>
          </dl>
          <div className="rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4 text-sm">
            <div className="font-black text-[color:var(--app-fg)]">
              Fontes que serão substituídas
            </div>
            <p className="mt-1 text-[color:var(--app-muted)]">
              {confirmationTarget === "payrollLoan"
                ? "Empréstimo Consignado"
                : selectedBaseSources.join(", ")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-10 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]">
              Revisar arquivos
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmationTarget === "payrollLoan") {
                  publishPayrollLoan();
                } else {
                  publishBase();
                }
              }}
              className="min-h-10 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2 text-sm font-black text-[color:var(--app-action-text)]"
            >
              Confirmar importação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
