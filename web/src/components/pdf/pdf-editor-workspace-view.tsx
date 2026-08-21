"use client";

import type { usePdfEditorWorkspaceController } from "./pdf-editor-workspace";

type Model = ReturnType<typeof usePdfEditorWorkspaceController>;

export function PdfEditorWorkspaceView({ model }: { model: Model }) {
  const { ArrowLeft, Check, Download, EditorCanvas, Eraser, Link, Loader2, PdfPageThumbnail, Redo2, Save, TOOL_OPTIONS, Trash2, Undo2, Upload, annotations, color, commitAnnotations, document, error, fileName, finish, fontSize, future, getInputProps, getRootProps, historyVersion, isDragActive, jobId, lineWidth, locked, opacity, operation, pageAnnotations, pages, past, processing, recovering, redo, saveState, selectedPage, setColor, setFontSize, setLineWidth, setOpacity, setSelectedPageId, setText, setTool, text, tool, triggerDownload, undo, uploadProgress } = model;
  return (
<div className="pdf-workspace pdf-editor-workspace">
      <header className="pdf-workspace__header">
        <div>
          <Link href="/pdf" className="pdf-back-link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Ferramentas PDF
          </Link>
          <p className="pdf-eyebrow">
            {operation === "ANNOTATE" ? "Anotar PDF" : "Editar PDF"}
          </p>
          <h1>
            {operation === "ANNOTATE"
              ? "Destaque e registre observações"
              : "Adicione conteúdo ao documento"}
          </h1>
        </div>
        <div className="pdf-editor-header-actions">
          <span className="pdf-save-state" data-state={saveState}>
            {saveState === "saving"
              ? "Salvando"
              : saveState === "saved"
                ? "Alterações salvas"
                : saveState === "error"
                  ? "Falha ao salvar"
                  : "Rascunho automático"}
          </span>
          <button
            type="button"
            className="pdf-icon-button"
            title="Desfazer"
            disabled={!past.current.length || locked}
            onClick={undo}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-icon-button"
            title="Refazer"
            disabled={!future.current.length || locked}
            onClick={redo}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!document || !selectedPage ? (
        <div
          {...getRootProps()}
          className="pdf-dropzone pdf-editor-dropzone"
          data-active={isDragActive}
        >
          <input {...getInputProps()} />
          {recovering ? (
            <>
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
              <strong>Reabrindo edição</strong>
              <span>Aguarde enquanto o documento é reaberto.</span>
            </>
          ) : uploadProgress !== null ? (
            <>
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
              <strong>Enviando PDF</strong>
              <div className="pdf-progress">
                <span style={{ width: `${uploadProgress}%` }} />
              </div>
              <small>{uploadProgress}%</small>
            </>
          ) : (
            <>
              <Upload className="size-8" aria-hidden="true" />
              <strong>Solte um PDF aqui</strong>
              <span>ou selecione um arquivo de até 100 MB</span>
            </>
          )}
        </div>
      ) : (
        <div className="pdf-editor-layout">
          <aside className="pdf-editor-pages" aria-label="Páginas">
            <div className="pdf-editor-pages__title">
              <strong>{fileName}</strong>
              <span>{pages.length} páginas</span>
            </div>
            <div className="pdf-editor-pages__list">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  type="button"
                  className="pdf-editor-page"
                  data-selected={page.id === selectedPage.id}
                  onClick={() => setSelectedPageId(page.id)}
                >
                  <PdfPageThumbnail
                    document={document}
                    pageNumber={page.sourcePage}
                    rotation={page.rotation}
                  />
                  <span>Página {index + 1}</span>
                  {annotations.some(
                    (annotation) => annotation.pageId === page.id,
                  ) ? (
                    <Check className="size-3.5" aria-label="Página alterada" />
                  ) : null}
                </button>
              ))}
            </div>
          </aside>

          <main className="pdf-editor-stage">
            <div className="pdf-editor-toolbar" role="toolbar">
              {TOOL_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-active={tool === option.value}
                    disabled={locked}
                    title={option.label}
                    onClick={() => setTool(option.value)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="pdf-editor-stage__scroll">
              <EditorCanvas
                annotations={pageAnnotations}
                color={color}
                document={document}
                fontSize={fontSize}
                lineWidth={lineWidth}
                opacity={opacity}
                page={selectedPage}
                text={text}
                tool={tool}
                onAdd={(annotation) =>
                  commitAnnotations((current) => [...current, annotation])
                }
              />
            </div>
          </main>

          <aside className="pdf-editor-properties">
            <section>
              <h2>Propriedades</h2>
              <label>
                Cor
                <span className="pdf-color-control">
                  <input
                    type="color"
                    value={color}
                    disabled={locked}
                    onChange={(event) => setColor(event.target.value)}
                  />
                  <code>{color.toUpperCase()}</code>
                </span>
              </label>
              {tool === "TEXT" ? (
                <>
                  <label>
                    Texto
                    <textarea
                      value={text}
                      maxLength={2_000}
                      disabled={locked}
                      rows={4}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </label>
                  <label>
                    Tamanho <span>{fontSize} pt</span>
                    <input
                      type="range"
                      min="8"
                      max="96"
                      value={fontSize}
                      disabled={locked}
                      onChange={(event) =>
                        setFontSize(Number(event.target.value))
                      }
                    />
                  </label>
                </>
              ) : null}
              {tool === "DRAW" ? (
                <label>
                  Espessura <span>{lineWidth} pt</span>
                  <input
                    type="range"
                    min="1"
                    max="24"
                    value={lineWidth}
                    disabled={locked}
                    onChange={(event) =>
                      setLineWidth(Number(event.target.value))
                    }
                  />
                </label>
              ) : null}
              {tool === "HIGHLIGHT" ||
              tool === "RECTANGLE" ||
              tool === "DRAW" ? (
                <label>
                  Opacidade <span>{Math.round(opacity * 100)}%</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={opacity}
                    disabled={locked}
                    onChange={(event) => setOpacity(Number(event.target.value))}
                  />
                </label>
              ) : null}
            </section>

            <section>
              <div className="pdf-editor-properties__heading">
                <h2>Elementos nesta página</h2>
                <span>{pageAnnotations.length}</span>
              </div>
              <div className="pdf-editor-elements">
                {pageAnnotations.length ? (
                  pageAnnotations.map((annotation, index) => (
                    <div key={annotation.id}>
                      <span
                        className="pdf-editor-elements__swatch"
                        style={{ background: annotation.color }}
                      />
                      <span>
                        {annotation.type === "TEXT"
                          ? annotation.text
                          : annotation.type === "HIGHLIGHT"
                            ? `Destaque ${index + 1}`
                            : annotation.type === "RECTANGLE"
                              ? `Retângulo ${index + 1}`
                              : `Desenho ${index + 1}`}
                      </span>
                      <button
                        type="button"
                        title="Excluir elemento"
                        disabled={locked}
                        onClick={() =>
                          commitAnnotations((current) =>
                            current.filter((item) => item.id !== annotation.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p>Nenhum elemento nesta página.</p>
                )}
              </div>
              {pageAnnotations.length ? (
                <button
                  type="button"
                  className="pdf-editor-clear"
                  disabled={locked}
                  onClick={() =>
                    commitAnnotations((current) =>
                      current.filter(
                        (annotation) => annotation.pageId !== selectedPage.id,
                      ),
                    )
                  }
                >
                  <Eraser className="size-4" aria-hidden="true" />
                  Limpar página
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      )}

      {error ? (
        <div className="pdf-workspace__error" role="alert">
          {error}
        </div>
      ) : null}

      {document ? (
        <footer className="pdf-workspace__footer">
          <div>
            {processing.status === "QUEUED" ||
            processing.status === "RUNNING" ? (
              <>
                <span>Aplicando suas alterações</span>
                <div className="pdf-progress">
                  <span style={{ width: `${processing.progress}%` }} />
                </div>
              </>
            ) : processing.status === "SUCCEEDED" ? (
              <span className="pdf-finished">
                <Check className="size-4" aria-hidden="true" />
                PDF pronto para download
              </span>
            ) : (
              <span>
                {annotations.length} elemento
                {annotations.length === 1 ? "" : "s"} no documento
              </span>
            )}
          </div>
          <div>
            {processing.output && jobId ? (
              <button
                type="button"
                className="pdf-secondary-action"
                onClick={() => {
                  const output = processing.output;
                  if (!output) return;

                  triggerDownload(
                    `/api/pdf/jobs/${jobId}/outputs/${output.id}`,
                  );
                }}
              >
                <Download className="size-4" aria-hidden="true" />
                Baixar novamente
              </button>
            ) : null}
            <button
              type="button"
              className="pdf-primary-action"
              disabled={!jobId || locked || saveState === "saving"}
              onClick={() => void finish()}
            >
              {processing.status === "QUEUED" ||
              processing.status === "RUNNING" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Salvar PDF
            </button>
          </div>
        </footer>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {historyVersion}
      </span>
    </div>
  );
}
