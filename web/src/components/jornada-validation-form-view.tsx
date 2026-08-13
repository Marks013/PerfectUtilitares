"use client";

import type { useJornadaValidationFormController } from "./jornada-validation-form";
import { JornadaHistorySection } from "./jornada-validation-form-jornada-history-section";

type Model = ReturnType<typeof useJornadaValidationFormController>;

export function JornadaValidationFormView({ model }: { model: Model }) {
  const { CheckCircle2, Clock3, Download, FileSpreadsheet, INTERJORNADA_HELP_TEXT, Info, Loader2, ResultCard, RotateCcw, TableProperties, Upload, batchFile, batchMutation, batchPdfDetalhado, batchPdfError, batchRepeated, batchTopErrors, batchUsarHorariosAgrupados, batchValidarIntervalos, batchValidarJornada, batchValidarPeriodos, canShowSabado, duracaoPrincipal, duracaoSegundaJornada, form, formatField, getCombinedMonthlyHours, getCombinedWeeklyHours, horariosField, interjornadaAtiva, isBatchPdfExporting, isCombinedResponse, joinCodigos, mutation, sabadoField, segundaJornadaField, setBatchFile, setBatchPdfDetalhado, setBatchPdfError, setBatchUsarHorariosAgrupados, setBatchValidarIntervalos, setBatchValidarJornada, setBatchValidarPeriodos, submitBatchPdfExport, submitBatchValidation, submitValidation, sumDurations, temJornadaNoturna } = model;
  return (
<div className="jornada-studio">
      <section className="jornada-command">
        <div className="jornada-command__intro">
          <p className="jornada-command__kicker">Validador de jornada</p>
          <h1>Validar jornadas.</h1>
          <p>
            Digite a escala, confira o diagnóstico e selecione somente jornadas
            válidas para gerar a alteração.
          </p>
          {temJornadaNoturna ? (
            <aside className="rounded-xl border border-amber-300/40 bg-amber-100/10 p-4 text-sm leading-relaxed text-[color:var(--app-muted)]">
            <strong className="block text-[color:var(--app-fg)]">
              Hora noturna reduzida — aviso orientativo
            </strong>
            <span className="mt-1 block">
              No trabalho urbano entre 22h e 5h, cada 52min30s corresponde a 1
              hora noturna: 7 horas reais equivalem a 8 horas computadas, com
              adicional de no mínimo 20%. Se a jornada noturna for cumprida e
              continuar após 5h, a prorrogação pode receber tratamento noturno
              conforme o caso. Confirme sempre a convenção, o acordo coletivo e
              a orientação do RH.
            </span>
            </aside>
          ) : null}
        </div>

        <form
          onSubmit={form.handleSubmit(submitValidation)}
          className="jornada-validator-panel"
        >
          <div className="jornada-panel-heading">
            <span className="jornada-panel-heading__icon">
              <Clock3 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2>
                {interjornadaAtiva
                  ? "Validar duas jornadas com interjornada"
                  : "Horários de segunda a sexta"}
              </h2>
              <p>
                {interjornadaAtiva
                  ? "Informe a primeira e a segunda jornada para conferir o descanso mínimo de 11 horas."
                  : "Use 2 ou 4 marcações, com ou sem dois-pontos."}
              </p>
            </div>
          </div>

          <label className="jornada-toggle" title={INTERJORNADA_HELP_TEXT}>
            <input type="checkbox" {...form.register("interjornadaAtiva")} />
            <span>
              <strong>
                Ativar interjornada
                <span
                  className="jornada-help-icon"
                  role="img"
                  aria-label={INTERJORNADA_HELP_TEXT}
                  title={INTERJORNADA_HELP_TEXT}
                >
                  <Info className="size-full" aria-hidden="true" />
                </span>
              </strong>
              <small>
                Abre dois campos de jornada e compara o descanso entre a saída
                final da primeira e a entrada da segunda.
              </small>
            </span>
          </label>

          <label className="jornada-field">
            <span>{interjornadaAtiva ? "Primeira jornada" : "Jornada principal"}</span>
            <input
              {...horariosField}
              onBlur={(event) => {
                horariosField.onBlur(event);
                formatField("horarios");
              }}
              className="jornada-time-input"
              placeholder="0800 1200 1300 1700"
            />
          </label>
          {form.formState.errors.horarios ? (
            <p className="jornada-field-error">
              {form.formState.errors.horarios.message}
            </p>
          ) : null}
          <p className="jornada-field-hint">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {duracaoPrincipal
              ? `Duração detectada: ${duracaoPrincipal.duracaoFormatada}`
              : "Digite 2 ou 4 horários separados por espaço"}
          </p>

          {interjornadaAtiva ? (
            <>
              <label className="jornada-field">
                <span>Segunda jornada</span>
                <input
                  {...segundaJornadaField}
                  onBlur={(event) => {
                    segundaJornadaField.onBlur(event);
                    formatField("segundaJornadaHorarios");
                  }}
                  className="jornada-time-input"
                  placeholder="0800 1200 1300 1700"
                />
              </label>
              {form.formState.errors.segundaJornadaHorarios ? (
                <p className="jornada-field-error">
                  {form.formState.errors.segundaJornadaHorarios.message}
                </p>
              ) : null}
              <p className="jornada-field-hint">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {duracaoSegundaJornada
                  ? `Duração detectada: ${duracaoSegundaJornada.duracaoFormatada}`
                  : "Digite a jornada seguinte para calcular a interjornada"}
              </p>
            </>
          ) : null}

          {canShowSabado ? (
            <>
              <label className="jornada-field">
                <span>Complemento de sábado</span>
                <input
                  {...sabadoField}
                  onBlur={(event) => {
                    sabadoField.onBlur(event);
                    formatField("sabadoHorarios");
                  }}
                  className="jornada-time-input"
                  placeholder="0800 1200"
                />
              </label>
              {form.formState.errors.sabadoHorarios ? (
                <p className="jornada-field-error">
                  {form.formState.errors.sabadoHorarios.message}
                </p>
              ) : (
                <p className="jornada-field-success">
                  A jornada principal está apta; informe 04:00 no sábado para
                  completar 44h semanais quando a regra ou exceção permitir.
                </p>
              )}
            </>
          ) : null}

          <label className="jornada-toggle">
            <input
              type="checkbox"
              {...form.register("autoFormatar")}
            />
            <span>
              <strong>Auto-formatar horários</strong>
              <small>Exemplo: 0800 vira 08:00 ao sair do campo.</small>
            </span>
          </label>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="jornada-primary-button"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            {mutation.isPending ? "Validando..." : "Validar"}
          </button>
        </form>

        <section className="jornada-result-panel">
          <div className="jornada-result-panel__header">
            <div>
              <p className="jornada-command__kicker">Resultado</p>
              <h2>Diagnóstico da validação</h2>
            </div>
            <span
              className={
                mutation.data
                  ? mutation.data.valido
                    ? "jornada-status jornada-status--valid"
                    : "jornada-status jornada-status--invalid"
                  : "jornada-status"
              }
            >
              {mutation.data
                ? mutation.data.valido
                  ? "Válida"
                  : "Com ajuste"
                : "Aguardando"}
            </span>
          </div>
          {mutation.isError ? (
            <div className="jornada-alert jornada-alert--danger">
              {mutation.error.message}
            </div>
          ) : null}
          {mutation.data ? (
            isCombinedResponse(mutation.data) ? (
              <div className="jornada-result-stack">
                <ResultCard
                  title="Resumo"
                  result={{
                    valido: mutation.data.valido,
                    mensagem: mutation.data.mensagemInterjornada,
                    duracaoCalculada: sumDurations(
                      mutation.data.jornada1.duracaoCalculada,
                      mutation.data.jornada2.duracaoCalculada,
                    ),
                    codigo: joinCodigos(
                      mutation.data.jornada1.codigo,
                      mutation.data.jornada2.codigo,
                    ),
                    horasSemanais: getCombinedWeeklyHours(mutation.data),
                    horasMensais: getCombinedMonthlyHours(mutation.data),
                    intervalo:
                      mutation.data.interjornadaMinutos == null
                        ? undefined
                        : `${Math.floor(mutation.data.interjornadaMinutos / 60)}h${String(
                            mutation.data.interjornadaMinutos % 60,
                          ).padStart(2, "0")}`,
                  }}
                  intervalLabel="Interjornada"
                />
                <ResultCard
                  title={
                    mutation.data.modo === "interjornada"
                      ? "Primeira jornada"
                      : "Segunda a sexta"
                  }
                  result={mutation.data.jornada1}
                />
                <ResultCard
                  title={
                    mutation.data.modo === "interjornada"
                      ? "Segunda jornada"
                      : "Sábado"
                  }
                  result={mutation.data.jornada2}
                />
              </div>
            ) : (
              <div className="jornada-result-stack">
                <ResultCard title="Segunda a sexta" result={mutation.data} />
              </div>
            )
          ) : (
            <div className="jornada-result-empty">
              <CheckCircle2 className="size-8" aria-hidden="true" />
              <div>
                <strong>Resultado em destaque</strong>
                <p>
                  Depois de validar, este painel mostra duração, código,
                  intervalo e motivo do erro quando houver.
                </p>
              </div>
            </div>
          )}
        </section>
      </section>

      <details className="jornada-batch-panel">
        <summary className="jornada-batch-summary">
          <div>
            <div className="jornada-history-title">
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              <h2>Validação por planilha</h2>
            </div>
            <p>
              Importação XLSX em lote. Clique para abrir as opções, validar e
              gerar relatório PDF.
            </p>
          </div>
          <span className="jornada-status">
            {batchMutation.data ? `${batchMutation.data.totalLinhas} linhas` : "XLSX"}
          </span>
        </summary>

        <div className="jornada-batch-grid">
          <div className="jornada-batch-import">
            <label className="jornada-field">
              <span>Arquivo .xlsx</span>
              <input
                type="file"
                accept=".xlsx"
                className="jornada-compact-input"
                onChange={(event) => {
                  setBatchFile(event.target.files?.[0] ?? null);
                  batchMutation.reset();
                  setBatchPdfError(null);
                }}
              />
            </label>

            <div className="jornada-batch-options">
              <label className="jornada-toggle">
                <input
                  type="checkbox"
                  checked={batchValidarPeriodos}
                  onChange={(event) =>
                    setBatchValidarPeriodos(event.target.checked)
                  }
                />
                <span>
                  <strong>Validar períodos</strong>
                  <small>Cada período antes/depois do intervalo deve respeitar 04:00.</small>
                </span>
              </label>
              <label className="jornada-toggle">
                <input
                  type="checkbox"
                  checked={batchValidarJornada}
                  onChange={(event) =>
                    setBatchValidarJornada(event.target.checked)
                  }
                />
                <span>
                  <strong>Validar duração da jornada</strong>
                  <small>Compara o total trabalhado com as regras ativas.</small>
                </span>
              </label>
              <label className="jornada-toggle">
                <input
                  type="checkbox"
                  checked={batchValidarIntervalos}
                  onChange={(event) =>
                    setBatchValidarIntervalos(event.target.checked)
                  }
                />
                <span>
                  <strong>Validar intervalos</strong>
                  <small>Confere mínimo e máximo conforme a jornada encontrada.</small>
                </span>
              </label>
              <label className="jornada-toggle">
                <input
                  type="checkbox"
                  checked={batchUsarHorariosAgrupados}
                  onChange={(event) =>
                    setBatchUsarHorariosAgrupados(event.target.checked)
                  }
                />
                <span>
                  <strong>Horários agrupados na coluna B</strong>
                  <small>
                    Use para planilhas com código na coluna A e a jornada completa
                    em uma única célula.
                  </small>
                </span>
              </label>
              <label className="jornada-toggle">
                <input
                  type="checkbox"
                  checked={batchPdfDetalhado}
                  onChange={(event) =>
                    setBatchPdfDetalhado(event.target.checked)
                  }
                />
                <span>
                  <strong>PDF Detalhado</strong>
                  <small>
                    Lista cada colaborador com matrícula, horário principal e
                    horário de sábado quando existir.
                  </small>
                </span>
              </label>
            </div>

            <button
              type="button"
              className="jornada-primary-button"
              disabled={!batchFile || batchMutation.isPending}
              onClick={submitBatchValidation}
            >
              {batchMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              {batchMutation.isPending ? "Validando planilha..." : "Validar planilha"}
            </button>

            <button
              type="button"
              className="jornada-secondary-button"
              disabled={!batchFile || isBatchPdfExporting}
              onClick={submitBatchPdfExport}
            >
              {isBatchPdfExporting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              {isBatchPdfExporting ? "Gerando relatório..." : "Gerar relatório PDF"}
            </button>

            {batchMutation.isError ? (
              <div className="jornada-alert jornada-alert--danger">
                {batchMutation.error.message}
              </div>
            ) : null}
            {batchPdfError ? (
              <div className="jornada-alert jornada-alert--danger">
                {batchPdfError}
              </div>
            ) : null}
          </div>

          <div className="jornada-batch-help">
            <div className="jornada-result-card" data-valid="true">
              <div className="jornada-result-card__heading">
                <span className="jornada-result-card__icon">
                  <TableProperties className="size-4" aria-hidden="true" />
                </span>
                <span>Relatório 110</span>
              </div>
              <div className="jornada-batch-instructions">
                <p>Layout padrão do sistema Senior.</p>
                <ul>
                  <li>Matrícula na coluna A, nome na C e cargo na E.</li>
                  <li>Horários nas colunas I, K, L e N.</li>
                  <li>A leitura começa na linha 3 e ignora cabeçalhos.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {batchMutation.data ? (
          <div className="jornada-batch-results">
            <div className="jornada-batch-stats">
              <div>
                <dt>Válidas</dt>
                <dd>{batchMutation.data.validos}</dd>
              </div>
              <div>
                <dt>Com erro</dt>
                <dd>{batchMutation.data.erros}</dd>
              </div>
              <div>
                <dt>Total de validações</dt>
                <dd>{batchMutation.data.totalLinhas}</dd>
              </div>
            </div>

            {batchTopErrors.length > 0 ? (
              <div className="jornada-batch-table-wrap">
                <table className="jornada-batch-table">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Nome/Código</th>
                      <th>Jornada</th>
                      <th>Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchTopErrors.map((line) => (
                      <tr key={`${line.numeroLinha}:${line.jornadaCompleta}`}>
                        <td>{line.numeroLinha}</td>
                        <td>{line.nome || line.matricula || "-"}</td>
                        <td>{line.jornadaCompleta}</td>
                        <td>{line.resultado?.mensagem ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="jornada-alert jornada-alert--success">
                Nenhum erro encontrado na planilha importada.
              </div>
            )}

            {batchRepeated.length > 0 ? (
              <div className="jornada-batch-repeated">
                {batchRepeated.map(([jornada, count]) => (
                  <span key={jornada}>
                    {jornada} - {count}
                  </span>
                ))}
                <strong>
                  Total de validações - {batchMutation.data.totalLinhas}
                </strong>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>

      <JornadaHistorySection model={model} />
    </div>
  );
}
