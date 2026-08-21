"use client";

import type { usePdfOrganizerWorkspaceController } from "./pdf-organizer-workspace";

type Model = ReturnType<typeof usePdfOrganizerWorkspaceController>;

export function PdfOrganizerWorkspaceView({ model }: { model: Model }) {
  const { Archive, ArrowLeft, Check, Copy, Crop, DndContext, Download, DragOverlay, GripVertical, Link, Loader2, PdfVisualCropEditor, Redo2, RotateCw, Save, SortableContext, SortablePage, Trash2, Undo2, Upload, X, activePage, applyCrop, closestCenter, copy, cropMargins, cropPreviewPage, documents, duplicate, error, finalizePdf, future, getInputProps, getRootProps, handleDragEnd, handleDragStart, handleSelect, historyVersion, isDragActive, jobId, menuPageId, operation, pages, past, processing, processingLocked, rectSortingStrategy, redo, remove, rotate, saveState, selected, selectedIds, sensors, setActiveId, setCropMargins, setError, setMenuPageId, setSelectedIds, undo, upload } = model;
  return (
<div className="pdf-workspace">
      <header className="pdf-workspace__header">
        <div className="pdf-workspace__title">
          <Link href="/pdf" className="pdf-icon-button" title="Voltar">
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span className="sr-only">Voltar às ferramentas</span>
          </Link>
          <div>
            <p className="pdf-eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
          </div>
        </div>

        <div className="pdf-workspace__status" aria-live="polite">
          {saveState === "saving" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Salvando
            </>
          ) : null}
          {saveState === "saved" ? (
            <>
              <Save className="size-4" aria-hidden="true" />
              Alterações salvas
            </>
          ) : null}
          {saveState === "error" ? "Falha ao salvar" : null}
        </div>
      </header>

      <div className="pdf-workspace__toolbar">
        <div className="pdf-toolbar-group">
          <button
            type="button"
            className="pdf-icon-button"
            onClick={undo}
            disabled={!past.current.length || processingLocked}
            title="Desfazer"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            <span className="sr-only">Desfazer</span>
          </button>
          <button
            type="button"
            className="pdf-icon-button"
            onClick={redo}
            disabled={!future.current.length || processingLocked}
            title="Refazer"
          >
            <Redo2 className="size-4" aria-hidden="true" />
            <span className="sr-only">Refazer</span>
          </button>
          <span className="sr-only">{historyVersion}</span>
        </div>

        <div className="pdf-toolbar-group pdf-toolbar-group--selection">
          <span>
            {selected.length
              ? `${selected.length} selecionada${selected.length > 1 ? "s" : ""}`
              : `${pages.length} página${pages.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={() => rotate(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <RotateCw className="size-4" aria-hidden="true" />
            Girar
          </button>
          <button
            type="button"
            onClick={() => duplicate(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <Copy className="size-4" aria-hidden="true" />
            Duplicar
          </button>
          <button
            type="button"
            className="pdf-danger-button"
            onClick={() => remove(selectedIds)}
            disabled={!selectedIds.size || processingLocked}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Excluir
          </button>
          {selectedIds.size ? (
            <button
              type="button"
              className="pdf-icon-button"
              onClick={() => setSelectedIds(new Set())}
              title="Limpar seleção"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Limpar seleção</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="pdf-primary-button"
          disabled={!pages.length || Boolean(upload) || processingLocked}
          onClick={() => void finalizePdf()}
        >
          {processing.status === "QUEUED" || processing.status === "RUNNING" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {processing.status === "QUEUED"
              ? "Na fila"
              : processing.status === "RUNNING"
              ? `Organizando ${processing.progress}%`
              : processing.status === "SUCCEEDED"
                ? "PDF concluído"
                : copy.finishLabel}
        </button>
      </div>

      {operation === "CROP" && pages.length ? (
        <section className="pdf-crop-controls">
          <header>
            <div>
              <strong>Área que será mantida</strong>
              <small>
                Ajuste com o mouse, toque, teclado ou campos numéricos. A área
                escura será removida.
              </small>
            </div>
            <div>
              <button
                type="button"
                disabled={processingLocked || !selectedIds.size}
                onClick={() => void applyCrop(selectedIds)}
              >
                <Crop className="size-4" aria-hidden="true" />
                Aplicar nas selecionadas
              </button>
              <button
                type="button"
                disabled={processingLocked}
                onClick={() =>
                  void applyCrop(new Set(pages.map((page) => page.id)))
                }
              >
                Aplicar em todas
              </button>
            </div>
          </header>
          {cropPreviewPage ? (
            <PdfVisualCropEditor
              disabled={processingLocked}
              document={documents.current.get(cropPreviewPage.artifactId)}
              margins={cropMargins}
              onChange={setCropMargins}
              pageNumber={cropPreviewPage.sourcePage}
              rotation={cropPreviewPage.rotation}
            />
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="pdf-alert pdf-alert--danger" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {processing.status === "QUEUED" || processing.status === "RUNNING" ? (
        <section className="pdf-processing-panel" aria-live="polite">
          <div>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>
                {processing.status === "QUEUED"
                  ? "Aguardando para organizar os PDFs"
                  : "Organizando as páginas"}
              </strong>
              <small>
                Você pode acompanhar o avanço sem recarregar a página.
              </small>
            </span>
          </div>
          <div
            className="pdf-progress-track"
            role="progressbar"
            aria-label="Progresso do PDF"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={processing.progress}
          >
            <span style={{ width: `${processing.progress}%` }} />
          </div>
          <b>{processing.progress}%</b>
        </section>
      ) : null}

      {processing.status === "SUCCEEDED" && processing.outputs.length ? (
        <section className="pdf-output-panel" aria-live="polite">
          <div className="pdf-output-panel__heading">
            <span>
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div>
              <strong>
                {processing.outputs.length === 1
                  ? "PDF pronto"
                  : `${processing.outputs.length} PDFs prontos`}
              </strong>
              <small>Downloads disponíveis durante 30 minutos.</small>
            </div>
          </div>

          <div className="pdf-output-list">
            {processing.outputs.map((output) => (
              <a
                key={output.id}
                href={`/api/pdf/jobs/${jobId}/outputs/${output.id}`}
                className="pdf-output-row"
              >
                <span>
                  <strong>{output.originalName}</strong>
                  <small>
                    {(Number(output.sizeBytes) / 1024 / 1024).toFixed(2)} MB
                  </small>
                </span>
                <Download className="size-4" aria-hidden="true" />
              </a>
            ))}
          </div>

          {processing.outputs.length > 1 ? (
            <a
              href={`/api/pdf/jobs/${jobId}/outputs/zip`}
              className="pdf-secondary-button"
            >
              <Archive className="size-4" aria-hidden="true" />
              Baixar todos em ZIP
            </a>
          ) : null}
        </section>
      ) : null}

      <div
        {...getRootProps({
          className: "pdf-dropzone",
          "data-active": isDragActive,
        })}
      >
        <input {...getInputProps()} />
        {upload ? (
          <div className="pdf-upload-progress">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <div>
              <strong>{upload.fileName}</strong>
              <div className="pdf-progress-track">
                <span style={{ width: `${upload.progress}%` }} />
              </div>
            </div>
            <span>{upload.progress}%</span>
          </div>
        ) : (
          <>
            <Upload className="size-5" aria-hidden="true" />
            <span>
              Arraste PDFs para inserir páginas ou{" "}
              <strong>selecione arquivos</strong>
            </span>
            <small>Até 20 arquivos, com no máximo 100 MB cada</small>
          </>
        )}
      </div>

      {pages.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={pages.map((page) => page.id)}
            strategy={rectSortingStrategy}
          >
            <section
              className="pdf-page-grid"
              aria-label="Páginas do documento"
            >
              {pages.map((page, index) => (
                <SortablePage
                  key={page.id}
                  page={page}
                  document={documents.current.get(page.artifactId)}
                  index={index}
                  selected={selectedIds.has(page.id)}
                  menuOpen={menuPageId === page.id}
                  locked={processingLocked}
                  onSelect={handleSelect}
                  onMenu={setMenuPageId}
                  onRotate={(id) => rotate(new Set([id]))}
                  onDuplicate={(id) => duplicate(new Set([id]))}
                  onDelete={(id) => remove(new Set([id]))}
                />
              ))}
            </section>
          </SortableContext>

          <DragOverlay>
            {activePage ? (
              <div className="pdf-page-drag-overlay">
                <GripVertical className="size-5" aria-hidden="true" />
                {activePage.fileName} · página {activePage.sourcePage}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <section className="pdf-empty-workspace">
          <div>
            <Upload className="size-8" aria-hidden="true" />
          </div>
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyDescription}</p>
        </section>
      )}
    </div>
  );
}
