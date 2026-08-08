"use client";

import type { useJornadaValidationFormController } from "./jornada-validation-form";

type Model = ReturnType<typeof useJornadaValidationFormController>;

export function JornadaHistorySection({ model }: { model: Model }) {
  const { AlertTriangle, CheckCircle2, Download, History, Link, Loader2, Trash2, addPdfPerson, allVisibleSelected, bulkSelectionMode, clearHistoryMutation, createPdfPerson, exportError, exportSelected, filteredHistorico, formatDate, getPrimaryMessage, getSecondaryMessages, hasAccount, hideInvalidHistory, historico, historicoQuery, historyPage, historyPageCount, isExporting, mutation, pdfPeopleByKey, removePdfPerson, selectableVisibleHistorico, selectedDeleteMutation, selectedErrorCount, selectedHistoryIds, selectedItemCount, selectedSet, selectedValidCount, selectionMode, setHideInvalidHistory, setHistoryPage, toggleAllVisible, toggleOne, totalErrorCount, totalValidCount, updatePdfPerson, visibleHistorico } = model;
  return (
<section className="jornada-history-panel">
        <div className="jornada-history-panel__header">
          <div>
            <div className="jornada-history-title">
              <History className="size-4" aria-hidden="true" />
              <h2>Últimas validações</h2>
            </div>
            <p>
              {hasAccount
                ? "Página com 10 registros. Selecione somente jornadas válidas para montar o PDF."
                : "Entre na sua conta para salvar, consultar e exportar suas validações."}
            </p>
          </div>
          <div className="jornada-history-summary" hidden={!hasAccount}>
            <span>{totalValidCount} válidas</span>
            <button
              type="button"
              onClick={() => {
                setHideInvalidHistory((value) => !value);
                setHistoryPage(1);
              }}
              aria-pressed={hideInvalidHistory}
              title={
                hideInvalidHistory
                  ? "Mostrar jornadas com erro"
                  : "Ocultar jornadas com erro"
              }
            >
              {hideInvalidHistory ? "Erros ocultos" : `${totalErrorCount} com erro`}
            </button>
          </div>
          <button
            hidden={!hasAccount}
            type="button"
            onClick={exportSelected}
            title={
              selectedItemCount === 0
                ? "Selecione ao menos uma jornada válida para gerar o PDF."
                : selectedValidCount === 0
                ? "As jornadas selecionadas têm erro e não podem gerar PDF."
                : "Gerar PDF somente com as jornadas válidas selecionadas."
            }
            disabled={
              selectedValidCount === 0 ||
              isExporting ||
              selectedDeleteMutation.isPending
            }
            className="jornada-secondary-button"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            Gerar PDF
          </button>
          <button
            hidden={!hasAccount}
            type="button"
            onClick={() => {
              if (selectedHistoryIds.length > 0) {
                if (
                  window.confirm(
                    selectedHistoryIds.length === 1
                      ? "Excluir 1 validação selecionada? Esta ação não pode ser desfeita."
                      : `Excluir ${selectedHistoryIds.length} validações selecionadas? Esta ação não pode ser desfeita.`,
                  )
                ) {
                  selectedDeleteMutation.mutate(selectedHistoryIds);
                }
                return;
              }

              if (
                window.confirm(
                  "Limpar todo o seu histórico de validações? Esta ação não pode ser desfeita.",
                )
              ) {
                clearHistoryMutation.mutate();
              }
            }}
            disabled={
              (historico.length === 0 && selectedHistoryIds.length === 0) ||
              clearHistoryMutation.isPending ||
              selectedDeleteMutation.isPending ||
              mutation.isPending ||
              isExporting
            }
            className="jornada-danger-button"
          >
            {clearHistoryMutation.isPending || selectedDeleteMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            {selectedHistoryIds.length > 0
              ? "Excluir selecionados"
              : "Limpar meu histórico"}
          </button>
        </div>
        {!hasAccount ? (
          <div className="jornada-alert jornada-alert--success">
            <span>As validações públicas não são armazenadas.</span>{" "}
            <Link href="/login?callbackUrl=/jornada/validar">
              Entrar para ativar o histórico
            </Link>
          </div>
        ) : null}
        {exportError ? (
          <div className="jornada-alert jornada-alert--danger">
            {exportError}
          </div>
        ) : null}
        {selectedItemCount > 0 && selectedValidCount === 0 ? (
          <div className="jornada-alert jornada-alert--danger">
            As validações selecionadas têm erro. Elas podem ser excluídas pelo
            botão Excluir selecionados, mas não geram PDF. Para gerar o PDF,
            desmarque os erros e selecione uma jornada válida.
          </div>
        ) : null}
        {selectionMode === "valid" ? (
          <div className="jornada-alert jornada-alert--success">
            Seleção em modo válido: somente outras jornadas válidas podem ser
            adicionadas até a seleção atual ser limpa.
          </div>
        ) : null}
        {selectionMode === "invalid" && selectedErrorCount > 0 ? (
          <div className="jornada-alert jornada-alert--danger">
            Seleção em modo erro: somente outras jornadas com erro podem ser
            adicionadas até a seleção atual ser limpa.
          </div>
        ) : null}
        {clearHistoryMutation.isError ? (
          <div className="jornada-alert jornada-alert--danger">
            {clearHistoryMutation.error.message}
          </div>
        ) : null}
        {selectedDeleteMutation.isError ? (
          <div className="jornada-alert jornada-alert--danger">
            {selectedDeleteMutation.error.message}
          </div>
        ) : null}
        {clearHistoryMutation.isSuccess ? (
          <div className="jornada-alert jornada-alert--success">
            Histórico limpo. Registros removidos:{" "}
            {clearHistoryMutation.data.deletedCount}.
          </div>
        ) : null}
        {selectedDeleteMutation.isSuccess ? (
          <div className="jornada-alert jornada-alert--success">
            Registros selecionados removidos:{" "}
            {selectedDeleteMutation.data.deletedCount}.
          </div>
        ) : null}
        {selectedValidCount > 0 ? (
          <div className="jornada-pdf-editor">
            <div>
              <h3>
                Dados para Alteração de Jornada
              </h3>
              <p>
                Adicione uma ou mais pessoas para cada horário selecionado.
              </p>
            </div>
            {historico
              .filter((item) => selectedSet.has(item.key) && item.valido)
              .map((item) => (
                <div
                  key={item.key}
                  className="jornada-pdf-editor__card"
                >
                  <div className="jornada-pdf-editor__card-head">
                    <div>
                      <p>
                        {item.horarios}
                      </p>
                      <small>
                        Código: {item.codigo ?? "-"}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => addPdfPerson(item.key)}
                      className="jornada-ghost-button"
                    >
                      Adicionar pessoa
                    </button>
                  </div>
                  <div className="jornada-pdf-people">
                    {(pdfPeopleByKey[item.key] ?? [createPdfPerson()]).map(
                      (person, index) => (
                        <div
                          key={person.localId}
                          className="jornada-pdf-person"
                        >
                          <label>
                            Nome
                            <input
                              value={person.nome}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "nome",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                              placeholder={`Pessoa ${index + 1}`}
                            />
                          </label>
                          <label>
                            Matrícula (opcional)
                            <input
                              value={person.matricula}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "matricula",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                              placeholder="Matrícula"
                            />
                          </label>
                          <label>
                            Data de alteração
                            <input
                              type="date"
                              value={person.dataAlteracao}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "dataAlteracao",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removePdfPerson(item.key, person.localId)}
                            className="jornada-ghost-button self-end"
                          >
                            Remover
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : null}
        {historicoQuery.isLoading ? (
          <p className="jornada-history-empty">Carregando histórico...</p>
        ) : filteredHistorico.length > 0 ? (
          <div className="jornada-history-list">
            <label className="jornada-history-select-all">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                disabled={selectableVisibleHistorico.length === 0}
              />
              {selectionMode === "valid"
                ? "Selecionar válidas exibidas"
                : selectionMode === "invalid"
                ? "Selecionar erros exibidos"
                : bulkSelectionMode === "valid"
                ? "Selecionar válidas exibidas"
                : bulkSelectionMode === "invalid"
                ? "Selecionar erros exibidos"
                : "Selecione um item para definir o tipo"}
            </label>
            {visibleHistorico.map((item) => {
              const Icon = item.valido ? CheckCircle2 : AlertTriangle;
              const primaryMessage = getPrimaryMessage(item.mensagem);
              const secondaryMessages = getSecondaryMessages(item.mensagem);
              const blockedBySelection =
                (selectionMode === "valid" && !item.valido) ||
                (selectionMode === "invalid" && item.valido);
              return (
                <div
                  key={item.key}
                  className="jornada-history-item"
                  data-valid={item.valido}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.key)}
                    onChange={() => toggleOne(item)}
                    disabled={blockedBySelection && !selectedSet.has(item.key)}
                    title={
                      blockedBySelection && !selectedSet.has(item.key)
                        ? "Desmarque a seleção atual para alternar entre jornadas válidas e jornadas com erro."
                        : undefined
                    }
                    aria-label={`Selecionar jornada ${item.horarios}`}
                  />
                  <span className="jornada-history-item__body">
                    <span className="jornada-history-item__meta">
                      <span>{formatDate(item.createdAt)}</span>
                      <strong>{item.horarios}</strong>
                    </span>
                    <span className="jornada-history-item__message">
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{primaryMessage}</span>
                    </span>
                    {secondaryMessages.length > 0 ? (
                      <details className="jornada-history-details">
                        <summary>Ver detalhes do diagnóstico</summary>
                        <ul>
                          {secondaryMessages.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {!item.valido ? (
                      <span className="jornada-history-item__note">
                        Jornadas com erro podem ser excluídas em seleção separada,
                        mas não entram no PDF.
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {historyPageCount > 1 ? (
              <div className="jornada-history-pagination">
                <span>
                  Página {historyPage} de {historyPageCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    disabled={historyPage === 1}
                    className="jornada-ghost-button"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setHistoryPage((page) => Math.min(historyPageCount, page + 1))
                    }
                    disabled={historyPage === historyPageCount}
                    className="jornada-ghost-button"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="jornada-history-empty">
            {hideInvalidHistory
              ? "Nenhuma validação válida nesta visualização."
              : hasAccount
                ? "Nenhuma validação registrada ainda."
                : "Seu resultado atual aparece acima e não fica salvo."}
          </p>
        )}
      </section>
  );
}
