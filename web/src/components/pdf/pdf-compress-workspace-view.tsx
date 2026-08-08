"use client";

import type { usePdfCompressWorkspaceController } from "./pdf-compress-workspace";

type Model = ReturnType<typeof usePdfCompressWorkspaceController>;

export function PdfCompressWorkspaceView({ model }: { model: Model }) {
  const { Archive, ArrowLeft, COLOR_OPTIONS, Check, Download, FileSearch, FileText, Gauge, Link, Loader2, METHOD_OPTIONS, Minimize2, Palette, QUALITY_OPTIONS, ScanLine, Upload, X, analyses, analysisProgress, analysisSummary, analyzing, applyDocumentRecommendation, applyPreset, busy, error, files, formatBytes, getColorModeLabel, getContentKindLabel, getDetectedDpiLabel, getFileKey, getInputProps, getRootProps, inputBytes, isDragActive, jobId, outputBytes, outputs, processFiles, removeFile, savedPercent, setError, settings, updateSettings, work } = model;
  return (
<div className="pdf-workspace">
      <header className="pdf-workspace__header">
        <div className="pdf-workspace__title">
          <Link href="/pdf" className="pdf-icon-button" title="Voltar">
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span className="sr-only">Voltar às ferramentas</span>
          </Link>
          <div>
            <p className="pdf-eyebrow">Comprimir PDF</p>
            <h1>Reduza arquivos sem perder legibilidade</h1>
          </div>
        </div>
      </header>

      <section className="pdf-compress-settings">
        <div className="pdf-compress-settings__heading">
          <div>
            <strong>Configuração da compactação</strong>
            <small>
              {analyzing
                ? `Analisando ${analysisProgress.completed} de ${analysisProgress.total}`
                : analyses.length
                  ? "Ajuste inicial calculado conforme o conteúdo enviado."
                  : "Envie um PDF para detectar suas características."}
            </small>
          </div>
          <span>
            {analyzing
              ? "Analisando"
              : settings?.preset === "SOURCE"
                ? "Baseada no documento"
                : settings?.preset
                  ? QUALITY_OPTIONS.find(
                      (option) => option.value === settings.preset,
                    )?.label
                  : settings
                    ? "Personalizado"
                    : "Aguardando PDF"}
          </span>
        </div>

        {analysisSummary ? (
          <div className="pdf-compression-detected" aria-live="polite">
            <div className="pdf-compression-detected__heading">
              <FileSearch className="size-5" aria-hidden="true" />
              <span>
                <strong>Detectado nos arquivos</strong>
                <small>
                  Amostra de {analysisSummary.sampledPages} de{" "}
                  {analysisSummary.pageCount} página
                  {analysisSummary.pageCount === 1 ? "" : "s"}
                </small>
              </span>
            </div>
            <dl>
              <div>
                <dt>Conteúdo</dt>
                <dd>{analysisSummary.contentKind}</dd>
              </div>
              <div>
                <dt>Tonalidade</dt>
                <dd>{getColorModeLabel(analysisSummary.colorMode)}</dd>
              </div>
              <div>
                <dt>Resolução estimada</dt>
                <dd>
                  {analysisSummary.sourceDpi === null
                    ? "Não se aplica a vetores"
                    : `${analysisSummary.sourceDpi} DPI`}
                </dd>
              </div>
            </dl>
          </div>
        ) : analyzing ? (
          <div className="pdf-compression-empty" aria-live="polite">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>Lendo o conteúdo dos PDFs</strong>
              <small>
                Detectando páginas, imagens, tonalidade e resolução.
              </small>
            </span>
          </div>
        ) : (
          <div className="pdf-compression-empty">
            <FileSearch className="size-5" aria-hidden="true" />
            <span>
              <strong>Nenhuma configuração aplicada</strong>
              <small>
                Os controles serão preenchidos somente após a análise do
                documento.
              </small>
            </span>
          </div>
        )}

        <fieldset className="pdf-quality-control">
          <legend className="sr-only">Perfil de compactação</legend>
          <label
            data-active={settings?.preset === "SOURCE"}
            data-disabled={busy || analyzing || !analyses.length}
          >
            <input
              className="sr-only"
              type="radio"
              name="compression-preset"
              value="SOURCE"
              checked={settings?.preset === "SOURCE"}
              disabled={busy || analyzing || !analyses.length}
              onChange={() => applyDocumentRecommendation(analyses)}
            />
            <strong>Do documento</strong>
            <small>Usa a análise como ponto de partida</small>
          </label>
          {QUALITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              data-active={settings?.preset === option.value}
              data-disabled={busy || analyzing || !files.length}
            >
              <input
                className="sr-only"
                type="radio"
                name="compression-preset"
                value={option.value}
                checked={settings?.preset === option.value}
                disabled={busy || analyzing || !files.length}
                onChange={() => applyPreset(option.value)}
              />
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </label>
          ))}
        </fieldset>

        {settings ? (
          <>
            <div className="pdf-compression-options">
              <fieldset className="pdf-compression-option pdf-compression-option--wide">
                <legend>
                  <Minimize2 className="size-4" aria-hidden="true" />
                  Tipo de compactação
                </legend>
                <div className="pdf-compression-methods">
                  {METHOD_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      data-active={settings.method === option.value}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="compression-method"
                        value={option.value}
                        checked={settings.method === option.value}
                        disabled={busy}
                        onChange={() =>
                          updateSettings({ method: option.value })
                        }
                      />
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset
                className="pdf-compression-option pdf-compression-option--wide"
                disabled={busy || settings.method === "LOSSLESS"}
              >
                <legend>
                  <Palette className="size-4" aria-hidden="true" />
                  Tratamento de cor
                </legend>
                <div className="pdf-color-mode-control">
                  {COLOR_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      data-active={settings.colorMode === option.value}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="compression-color-mode"
                        value={option.value}
                        checked={settings.colorMode === option.value}
                        onChange={() =>
                          updateSettings({ colorMode: option.value })
                        }
                      />
                      <span
                        className="pdf-color-swatch"
                        data-color={option.value.toLowerCase()}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="pdf-compression-option">
                <span>
                  <ScanLine className="size-4" aria-hidden="true" />
                  Resolução
                </span>
                <select
                  value={settings.dpi}
                  disabled={busy || settings.method === "LOSSLESS"}
                  onChange={(event) =>
                    updateSettings({ dpi: Number(event.target.value) })
                  }
                >
                  {[72, 96, 120, 150, 200, 220, 300].map((dpi) => (
                    <option key={dpi} value={dpi}>
                      {dpi} DPI
                    </option>
                  ))}
                </select>
                <small>Menos DPI reduz mais; 150 DPI mantém boa leitura.</small>
              </label>

              {settings.colorMode === "MONOCHROME" ? (
                <label className="pdf-compression-option">
                  <span>
                    <Gauge className="size-4" aria-hidden="true" />
                    Corte do preto
                    <b>{settings.monochromeThreshold}</b>
                  </span>
                  <input
                    type="range"
                    min={64}
                    max={224}
                    step={4}
                    value={settings.monochromeThreshold}
                    disabled={busy || settings.method === "LOSSLESS"}
                    onChange={(event) =>
                      updateSettings({
                        monochromeThreshold: Number(event.target.value),
                      })
                    }
                  />
                  <small>Valores maiores deixam mais áreas em preto.</small>
                </label>
              ) : (
                <label className="pdf-compression-option">
                  <span>
                    <Gauge className="size-4" aria-hidden="true" />
                    Qualidade JPEG
                    <b>{settings.imageQuality}%</b>
                  </span>
                  <input
                    type="range"
                    min={35}
                    max={95}
                    step={1}
                    value={settings.imageQuality}
                    disabled={busy || settings.method === "LOSSLESS"}
                    onChange={(event) =>
                      updateSettings({
                        imageQuality: Number(event.target.value),
                      })
                    }
                  />
                  <small>
                    Entre 65% e 80% costuma equilibrar tamanho e nitidez.
                  </small>
                </label>
              )}
            </div>

            <div
              className="pdf-compression-summary"
              data-method={settings.method}
            >
              <strong>
                {settings.method === "LOSSLESS"
                  ? "Conteúdo original preservado"
                  : settings.method === "AUTO"
                    ? "O menor resultado vence"
                    : "Configuração aplicada integralmente"}
              </strong>
              <small>
                {settings.method === "LOSSLESS"
                  ? "Mantém texto selecionável, vetores e imagens sem rasterizar."
                  : `${settings.dpi} DPI · ${
                      COLOR_OPTIONS.find(
                        (option) => option.value === settings.colorMode,
                      )?.label
                    } · ${
                      settings.colorMode === "MONOCHROME"
                        ? "PNG binário"
                        : `JPEG ${settings.imageQuality}%`
                    }. A recompressão visual achata as páginas para reduzir imagens já compactadas.`}
              </small>
            </div>
          </>
        ) : null}
      </section>

      <div
        {...getRootProps({
          className: "pdf-dropzone pdf-dropzone--large",
          "data-active": isDragActive,
        })}
      >
        <input {...getInputProps()} />
        <Upload className="size-6" aria-hidden="true" />
        <span>
          Arraste PDFs ou <strong>selecione arquivos</strong>
        </span>
        <small>Até 20 arquivos, com no máximo 100 MB cada</small>
      </div>

      {error ? (
        <div className="pdf-alert pdf-alert--danger" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {files.length ? (
        <section className="pdf-compress-files">
          <header>
            <div>
              <strong>
                {files.length} arquivo{files.length === 1 ? "" : "s"}
              </strong>
              <small>{formatBytes(inputBytes)} no total</small>
            </div>
            <button
              type="button"
              className="pdf-primary-button"
              disabled={
                busy || analyzing || !settings || work.phase === "SUCCEEDED"
              }
              onClick={() => void processFiles()}
            >
              {busy || analyzing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Minimize2 className="size-4" aria-hidden="true" />
              )}
              {analyzing
                ? "Analisando"
                : busy
                  ? "Processando"
                  : "Comprimir arquivos"}
            </button>
          </header>

          <div className="pdf-compress-file-list">
            {files.map((file) => (
              <div key={getFileKey(file)} className="pdf-compress-file-row">
                <FileText className="size-5" aria-hidden="true" />
                <span>
                  <strong>{file.name}</strong>
                  <small>
                    {formatBytes(file.size)}
                    {(() => {
                      const analysis = analyses.find(
                        (item) => item.fileKey === getFileKey(file),
                      );
                      if (!analysis) return "";
                      return ` · ${analysis.pageCount} página${
                        analysis.pageCount === 1 ? "" : "s"
                      } · ${getContentKindLabel(analysis)} · ${getColorModeLabel(
                        analysis.colorMode,
                      )} · ${getDetectedDpiLabel(analysis)}`;
                    })()}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy || analyzing}
                  title={`Remover ${file.name}`}
                  onClick={() => removeFile(getFileKey(file))}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {busy ? (
        <section className="pdf-processing-panel" aria-live="polite">
          <div>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>
              <strong>{work.detail}</strong>
              <small>Mantenha esta página aberta até concluir.</small>
            </span>
          </div>
          <div className="pdf-progress-track">
            <span style={{ width: `${work.progress}%` }} />
          </div>
          <b>{work.progress}%</b>
        </section>
      ) : null}

      {outputs.length && jobId ? (
        <section className="pdf-output-panel">
          <div className="pdf-output-panel__heading">
            <span>
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div>
              <strong>Compressão concluída</strong>
              <small>
                {savedPercent > 0
                  ? `${savedPercent}% menor · ${formatBytes(outputBytes)}`
                  : savedPercent < 0
                    ? `${Math.abs(savedPercent)}% maior · ${formatBytes(outputBytes)}`
                    : `Tamanho original preservado · ${formatBytes(outputBytes)}`}
              </small>
            </div>
          </div>
          <div className="pdf-output-list">
            {outputs.map((output, index) => {
              const originalSize = files[index]?.size;
              const outputSize = Number(output.sizeBytes);
              const reduction =
                originalSize && originalSize > 0
                  ? Math.round((1 - outputSize / originalSize) * 100)
                  : 0;
              return (
                <a
                  key={output.id}
                  href={`/api/pdf/jobs/${jobId}/outputs/${output.id}`}
                  className="pdf-output-row"
                >
                  <span>
                    <strong>{output.originalName}</strong>
                    <small>
                      {originalSize ? `${formatBytes(originalSize)} → ` : ""}
                      {formatBytes(outputSize)}
                      {reduction > 0 ? ` · ${reduction}% menor` : ""}
                    </small>
                  </span>
                  <Download className="size-4" aria-hidden="true" />
                </a>
              );
            })}
          </div>
          {outputs.length > 1 ? (
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
    </div>
  );
}
