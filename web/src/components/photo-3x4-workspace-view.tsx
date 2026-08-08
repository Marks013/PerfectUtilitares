"use client";

import type { usePhoto3x4WorkspaceController } from "./photo-3x4-workspace";

type Model = ReturnType<typeof usePhoto3x4WorkspaceController>;

export function Photo3x4WorkspaceView({ model }: { model: Model }) {
  const { Archive, ChevronLeft, ChevronRight, Cropper, Download, ImageIcon, Loader2, PHOTO_ASPECT, PHOTO_DEFAULTS, RotateCcw, ScanFace, Scissors, SlidersHorizontal, Upload, X, clearFiles, cropAreaBorderWidth, cropModeDescription, detectFace, detectFacesInBatch, editorStates, faceStatus, files, form, getEditorState, getFileKey, getPhotoFormErrorMessages, goToPhoto, hasFiles, isBatch, isBusy, isDetectingBatchFaces, isDetectingFace, previewBorderColor, previewBorderWidth, previewFilter, previewUrl, processPhotoFile, processZip, processingFileKey, progressPercent, resetAdjustments, selectedEditor, selectedFile, selectedIndex, selectedKey, setCropGeometry, setSelectedEditorState, setSelectedIndex, singlePhotoMutation, updateFiles, watchedAddBorder, watchedBorderColor, watchedQuality, workPreview, workProgress, zipMutation, zipResult } = model;
  return (
<div className="photo-studio">
      <section className="photo-workbench">
        <div className="photo-workbench__header">
          <div>
            <p className="photo-workbench__kicker">Editor de fotos</p>
            <h1>Fotos 3x4</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Saída fixa 3x4 para uma foto ou lote selecionado.
            </p>
          </div>
          <div className="photo-size-pill">
            {PHOTO_DEFAULTS.width}x{PHOTO_DEFAULTS.height}px
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <label className="photo-upload-zone">
            <Upload className="size-4" aria-hidden="true" />
            <span>
              {files.length
                ? `${files.length} foto${files.length > 1 ? "s" : ""} selecionada${files.length > 1 ? "s" : ""}`
                : "Selecionar fotos"}
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                updateFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>

          {hasFiles ? (
            <div className="space-y-4">
              <div className="photo-current-file">
                <div>
                  <p className="text-xs font-semibold uppercase text-neutral-500">
                    Editando
                  </p>
                  <p className="max-w-[320px] truncate text-sm font-semibold text-neutral-950">
                    {selectedFile?.name}
                  </p>
                </div>
                {isBatch ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToPhoto(-1)}
                      className="photo-icon-button"
                      aria-label="Foto anterior"
                    >
                      <ChevronLeft className="size-4" aria-hidden="true" />
                    </button>
                    <span className="min-w-16 text-center text-sm font-medium text-neutral-700">
                      {selectedIndex + 1}/{files.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => goToPhoto(1)}
                      className="photo-icon-button"
                      aria-label="Próxima foto"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="photo-editor-toolbar">
                <button
                  type="button"
                  onClick={() => setSelectedEditorState({ cropMode: "auto" })}
                  className={
                    selectedEditor.cropMode === "auto"
                      ? "photo-mode-button photo-mode-button--active"
                      : "photo-mode-button"
                  }
                >
                  Auto-crop
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEditorState({ cropMode: "manual" })}
                  className={
                    selectedEditor.cropMode === "manual"
                      ? "photo-mode-button photo-mode-button--active"
                      : "photo-mode-button"
                  }
                >
                  Recorte manual
                </button>
                <button
                  type="button"
                  onClick={detectFace}
                  disabled={!previewUrl || isBusy}
                  className="photo-mode-button"
                >
                  {isDetectingFace ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ScanFace className="size-4" aria-hidden="true" />
                  )}
                  {isDetectingFace ? "Detectando..." : "Auto detectar rosto"}
                </button>
                {isBatch ? (
                  <button
                    type="button"
                    onClick={detectFacesInBatch}
                    disabled={!hasFiles || isBusy}
                    className="photo-mode-button"
                  >
                    {isDetectingBatchFaces ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ScanFace className="size-4" aria-hidden="true" />
                    )}
                    {isDetectingBatchFaces ? "Detectando lote..." : "Auto detectar lote"}
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-neutral-500">
                {cropModeDescription}
              </p>

              {workProgress ? (
                <div className="photo-work-progress" aria-live="polite">
                  <div className="photo-work-progress__head">
                    <span>{workProgress.label}</span>
                    <strong>{progressPercent}%</strong>
                  </div>
                  <div className="photo-work-progress__bar">
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="photo-work-progress__meta">
                    <span>
                      {workProgress.current}/{workProgress.total}
                    </span>
                    {workProgress.detail ? (
                      <span title={workProgress.detail}>
                        {workProgress.detail}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="photo-preview-stage">
                {workProgress &&
                (isDetectingFace ||
                  isDetectingBatchFaces ||
                  singlePhotoMutation.isPending ||
                  zipMutation.isPending) ? (
                  <div className="photo-preview-overlay" aria-hidden="true">
                    <Loader2 className="size-8 animate-spin" />
                    <span>{workProgress.label}</span>
                    {workProgress.detail ? <small>{workProgress.detail}</small> : null}
                  </div>
                ) : null}
                {workPreview ? (
                  <div className="flex h-full items-center justify-center p-6">
                    {/* biome-ignore lint/performance/noImgElement: preview local do editor 3x4 */}
                    <img
                      src={workPreview.url}
                      alt=""
                      className="max-h-full max-w-full rounded-md object-contain shadow-xl"
                      style={{ filter: previewFilter }}
                    />
                  </div>
                ) : previewUrl && selectedEditor.cropMode === "manual" ? (
                  <Cropper
                    key={selectedKey}
                    image={previewUrl}
                    crop={selectedEditor.crop}
                    zoom={selectedEditor.zoom}
                    zoomWithScroll={false}
                    aspect={PHOTO_ASPECT}
                    initialCroppedAreaPixels={
                      selectedEditor.croppedArea ?? undefined
                    }
                    onCropChange={(nextCrop) => {
                      if (selectedEditor.pendingFaceArea) return;
                      setSelectedEditorState({ crop: nextCrop });
                    }}
                    onCropComplete={(_, areaPixels) => {
                      if (selectedEditor.pendingFaceArea) return;
                      setSelectedEditorState({ croppedArea: areaPixels });
                    }}
                    onCropSizeChange={(nextCropSize) => {
                      if (!selectedKey) return;
                      setCropGeometry((current) => ({
                        key: selectedKey,
                        mediaSize:
                          current.key === selectedKey ? current.mediaSize : null,
                        cropSize: nextCropSize,
                      }));
                    }}
                    onMediaLoaded={(nextMediaSize) => {
                      if (!selectedKey) return;
                      setCropGeometry((current) => ({
                        key: selectedKey,
                        mediaSize: nextMediaSize,
                        cropSize:
                          current.key === selectedKey ? current.cropSize : null,
                      }));
                    }}
                    onZoomChange={(nextZoom) => {
                      if (selectedEditor.pendingFaceArea) return;
                      setSelectedEditorState({ zoom: nextZoom });
                    }}
                    style={{
                      mediaStyle: {
                        filter: previewFilter,
                      },
                      cropAreaStyle: {
                        border: `${cropAreaBorderWidth}px solid ${previewBorderColor}`,
                        boxShadow: `0 0 0 9999px rgba(15, 23, 42, 0.45), inset 0 0 0 1px ${watchedBorderColor === "white" ? "#cbd5e1" : "#000000"}`,
                      },
                    }}
                    showGrid={false}
                  />
                ) : previewUrl ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div
                      className="overflow-hidden rounded-md border border-white/70 shadow-xl"
                      style={{
                        aspectRatio: `${PHOTO_DEFAULTS.width} / ${PHOTO_DEFAULTS.height}`,
                        backgroundColor: previewBorderColor,
                        padding: previewBorderWidth,
                        height: "100%",
                        maxHeight: "440px",
                      }}
                    >
                      {/* biome-ignore lint/performance/noImgElement: preview local recortado do editor 3x4 */}
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        style={{ filter: previewFilter }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-400">
                    <ImageIcon className="size-10" aria-hidden="true" />
                  </div>
                )}
              </div>

              {selectedEditor.cropMode === "manual" ? (
                <label className="block text-sm font-medium text-neutral-800">
                  Zoom
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={selectedEditor.zoom}
                    onChange={(event) =>
                      setSelectedEditorState({ zoom: Number(event.target.value) })
                    }
                    disabled={!previewUrl}
                    className="mt-2 w-full"
                  />
                </label>
              ) : null}

              <div className="photo-file-list">
                <div className="photo-file-list__header">
                  <span className="text-sm font-semibold text-neutral-900">
                    Arquivos
                  </span>
                  <button
                    type="button"
                    onClick={clearFiles}
                    className="photo-mini-button"
                  >
                    <X className="size-3" aria-hidden="true" />
                    Limpar
                  </button>
                </div>
                <div className="max-h-52 overflow-auto">
                  {files.map((file, index) => {
                    const fileKey = getFileKey(file);
                    const fileState = getEditorState(editorStates, fileKey);
                    const hasFaceCrop =
                      fileState.cropMode === "manual" && Boolean(fileState.croppedArea);
                    const isProcessingThisFile =
                      singlePhotoMutation.isPending && processingFileKey === fileKey;
                    return (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className={
                          index === selectedIndex
                            ? "photo-file-row photo-file-row--active"
                            : "photo-file-row"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedIndex(index)}
                          className="photo-file-row__select"
                        >
                          {file.name}
                        </button>
                        <span
                          className={
                            index === selectedIndex
                              ? "photo-file-row__meta text-neutral-200"
                              : "photo-file-row__meta text-neutral-500"
                          }
                        >
                          {hasFaceCrop ? <small>Rosto detectado</small> : null}
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <button
                          type="button"
                          onClick={() => processPhotoFile(file)}
                          disabled={isBusy}
                          className="photo-file-row__download"
                          title={`Baixar ${file.name}`}
                          aria-label={`Baixar ${file.name}`}
                        >
                          {isProcessingThisFile ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="size-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className="photo-actions">
            <button
              type="button"
              onClick={() => processPhotoFile(selectedFile)}
              disabled={!hasFiles || isBusy}
              className="photo-primary-button"
            >
              {singlePhotoMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Scissors className="size-4" aria-hidden="true" />
              )}
              {singlePhotoMutation.isPending ? "Processando..." : "Baixar foto atual"}
            </button>

            {isBatch ? (
              <button
                type="button"
                onClick={processZip}
                disabled={!hasFiles || isBusy}
                className="photo-secondary-button"
              >
                {zipMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                Baixar ZIP
              </button>
            ) : null}

            {zipResult ? (
              <a
                href={zipResult.url}
                download={zipResult.fileName}
                className="photo-secondary-button"
              >
                <Download className="size-4" aria-hidden="true" />
                ZIP pronto
              </a>
            ) : null}
          </div>

          {faceStatus ? (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
              {faceStatus}
            </p>
          ) : null}

          {singlePhotoMutation.isError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {singlePhotoMutation.error.message}
            </p>
          ) : null}

          {zipMutation.isError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {zipMutation.error.message}
            </p>
          ) : null}
        </div>
      </section>

      <aside className="photo-controls-panel">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Saída
        </h2>
        <div className="mt-4 grid gap-4">
          <button
            type="button"
            onClick={resetAdjustments}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {hasFiles ? "Resetar foto atual" : "Resetar ajustes"}
          </button>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              Tamanho final
            </p>
            <p className="mt-1 text-lg font-semibold text-neutral-950">
              3x4 · {PHOTO_DEFAULTS.width}x{PHOTO_DEFAULTS.height}px
            </p>
          </div>

          <label className="block text-sm font-medium text-neutral-800">
            Formato
            <select
              {...form.register("format")}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            >
              <option value="jpeg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-neutral-800">
            Contraste
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={selectedEditor.contrast}
              onChange={(event) =>
                setSelectedEditorState({ contrast: Number(event.target.value) })
              }
              className="mt-2 w-full"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              {Number(selectedEditor.contrast || PHOTO_DEFAULTS.contrast).toFixed(2)}
            </span>
          </label>

          <label className="block text-sm font-medium text-neutral-800">
            Brilho
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={selectedEditor.brightness}
              onChange={(event) =>
                setSelectedEditorState({ brightness: Number(event.target.value) })
              }
              className="mt-2 w-full"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              {Number(selectedEditor.brightness || PHOTO_DEFAULTS.brightness).toFixed(2)}
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              {...form.register("addBorder")}
              className="size-4 rounded border-neutral-300"
            />
            Adicionar borda
          </label>

          {watchedAddBorder ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-800">
                Borda
                <input
                  type="number"
                  min={1}
                  max={80}
                  {...form.register("borderWidth", { valueAsNumber: true })}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-800">
                Cor
                <select
                  {...form.register("borderColor")}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                >
                  <option value="black">Preta</option>
                  <option value="white">Branca</option>
                </select>
              </label>
            </div>
          ) : null}

          <label className="block text-sm font-medium text-neutral-800">
            Qualidade
            <input
              type="range"
              min={40}
              max={100}
              step={1}
              {...form.register("quality", { valueAsNumber: true })}
              className="mt-2 w-full"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              {Number(watchedQuality || PHOTO_DEFAULTS.quality)}
            </span>
          </label>
        </div>

        {Object.values(form.formState.errors).length ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Revise as configurações da foto:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {getPhotoFormErrorMessages(form.formState.errors).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

      </aside>
    </div>
  );
}
