"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  Download,
  Image as ImageIcon,
  Loader2,
  ScanFace,
  Scissors,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Cropper, {
  getInitialCropFromCroppedAreaPixels,
  type Area,
  type MediaSize,
  type Size,
} from "react-easy-crop";
import { useForm } from "react-hook-form";
import { createFaceCropArea } from "@/lib/photos/face-crop";
import {
  PHOTO_DEFAULTS,
  photoSettingsSchema,
  type PhotoSettings,
  type PhotoSettingsInput,
} from "@/lib/photos/schema";

type ResultFile = {
  url: string;
  fileName: string;
  label: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

type CropMode = "auto" | "manual";

const PHOTO_SETTINGS_STORAGE_KEY = "photo-3x4:settings:v2";
const PHOTO_ASPECT = PHOTO_DEFAULTS.width / PHOTO_DEFAULTS.height;

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") {
      return data.error;
    }

    return data.error?.message ?? "Falha ao processar imagem";
  } catch {
    return "Falha ao processar imagem";
  }
}

function getDownloadFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

function appendSettings(formData: FormData, values: PhotoSettings) {
  formData.set("quality", String(values.quality));
  formData.set("format", values.format === "original" ? "jpeg" : values.format);
  formData.set("contrast", String(values.contrast));
  formData.set("brightness", String(values.brightness));
  formData.set("addBorder", String(values.addBorder));
  formData.set("borderWidth", String(values.borderWidth));
  formData.set("borderColor", values.borderColor);
  formData.set("replaceOriginal", "true");
  formData.set("convertToJpg", "false");
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    image.src = url;
  });
}

function revokeResultUrls(results: ResultFile[]) {
  results.forEach((result) => URL.revokeObjectURL(result.url));
}

function downloadResult(result: ResultFile) {
  const link = document.createElement("a");
  link.href = result.url;
  link.download = result.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function Photo3x4Workspace() {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>("auto");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [faceStatus, setFaceStatus] = useState<string | null>(null);
  const [looseResults, setLooseResults] = useState<ResultFile[]>([]);
  const [zipResult, setZipResult] = useState<ResultFile | null>(null);
  const restoredSettings = useRef(false);

  const selectedFile = files[0] ?? null;
  const hasFiles = files.length > 0;
  const isSingle = files.length === 1;
  const isBatch = files.length > 1;

  const form = useForm<PhotoSettingsInput, unknown, PhotoSettings>({
    resolver: zodResolver(photoSettingsSchema),
    defaultValues: {
      ...PHOTO_DEFAULTS,
      format: "jpeg",
      replaceOriginal: true,
      convertToJpg: false,
    },
  });

  const watchedQuality = form.watch("quality");
  const watchedContrast = form.watch("contrast");
  const watchedBrightness = form.watch("brightness");
  const watchedAddBorder = form.watch("addBorder");
  const watchedBorderWidth = form.watch("borderWidth");
  const outputWidth = PHOTO_DEFAULTS.width;
  const outputHeight = PHOTO_DEFAULTS.height;
  const previewWidth = watchedAddBorder
    ? outputWidth + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputWidth;
  const previewHeight = watchedAddBorder
    ? outputHeight + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputHeight;

  useEffect(() => {
    try {
      const rawSettings = window.localStorage.getItem(PHOTO_SETTINGS_STORAGE_KEY);
      if (rawSettings) {
        const parsed = photoSettingsSchema.safeParse(JSON.parse(rawSettings));
        if (parsed.success) {
          form.reset({
            ...parsed.data,
            width: PHOTO_DEFAULTS.width,
            height: PHOTO_DEFAULTS.height,
            format: parsed.data.format === "original" ? "jpeg" : parsed.data.format,
            replaceOriginal: true,
            convertToJpg: false,
          });
        }
      }
    } catch {
      window.localStorage.removeItem(PHOTO_SETTINGS_STORAGE_KEY);
    } finally {
      restoredSettings.current = true;
    }
  }, [form]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      if (!restoredSettings.current) {
        return;
      }

      const parsed = photoSettingsSchema.safeParse({
        ...values,
        width: PHOTO_DEFAULTS.width,
        height: PHOTO_DEFAULTS.height,
        replaceOriginal: true,
        convertToJpg: false,
      });
      if (parsed.success) {
        window.localStorage.setItem(
          PHOTO_SETTINGS_STORAGE_KEY,
          JSON.stringify(parsed.data),
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [form]);

  useEffect(() => {
    if (!selectedFile || !isSingle) {
      setPreviewUrl(null);
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextPreviewUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setFaceStatus(null);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [isSingle, selectedFile]);

  useEffect(() => {
    if (isBatch && cropMode !== "auto") {
      setCropMode("auto");
    }
  }, [cropMode, isBatch]);

  useEffect(() => {
    return () => {
      revokeResultUrls(looseResults);
      if (zipResult) {
        URL.revokeObjectURL(zipResult.url);
      }
    };
  }, [looseResults, zipResult]);

  function clearResults() {
    revokeResultUrls(looseResults);
    setLooseResults([]);
    if (zipResult) {
      URL.revokeObjectURL(zipResult.url);
      setZipResult(null);
    }
  }

  function updateFiles(nextFiles: File[]) {
    clearResults();
    setFiles(nextFiles);
    setCropMode(nextFiles.length > 1 ? "auto" : cropMode);
  }

  async function processOne(file: File, values: PhotoSettings, cropArea?: Area | null) {
    const formData = new FormData();
    formData.set("file", file);
    appendSettings(formData, values);

    if (cropArea) {
      formData.set("crop", JSON.stringify(cropArea));
    }

    const response = await fetch("/api/fotos/processar", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const blob = await response.blob();
    return {
      url: URL.createObjectURL(blob),
      fileName: getDownloadFileName(response, "foto-3x4.jpg"),
      label: file.name,
    };
  }

  const looseMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (!hasFiles) {
        throw new Error("Selecione ao menos uma foto");
      }

      const nextResults: ResultFile[] = [];
      for (const file of files) {
        nextResults.push(
          await processOne(
            file,
            values,
            isSingle && cropMode === "manual" ? croppedArea : null,
          ),
        );
      }

      return nextResults;
    },
    onSuccess(results) {
      clearResults();
      setLooseResults(results);
      if (results.length === 1) {
        downloadResult(results[0]);
      }
    },
  });

  const zipMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (!hasFiles) {
        throw new Error("Selecione ao menos uma foto");
      }

      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      appendSettings(formData, values);

      const response = await fetch("/api/fotos/lote", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const blob = await response.blob();
      const processed = response.headers.get("x-processed-count") ?? "0";
      const errors = response.headers.get("x-error-count") ?? "0";

      return {
        url: URL.createObjectURL(blob),
        fileName: "fotos-3x4.zip",
        label: `${processed} processadas, ${errors} ignoradas`,
      };
    },
    onSuccess(result) {
      clearResults();
      setZipResult(result);
      downloadResult(result);
    },
  });

  const processLoose = form.handleSubmit((values) => looseMutation.mutate(values));
  const processZip = form.handleSubmit((values) => zipMutation.mutate(values));

  async function detectFace() {
    if (!previewUrl) {
      setFaceStatus("Selecione uma foto primeiro.");
      return;
    }

    setFaceStatus("Detectando rosto...");

    try {
      const image = await loadImage(previewUrl);
      const { FaceDetection } = await import("@mediapipe/face_detection");
      const detector = new FaceDetection({
        locateFile: (file) => `/mediapipe/face_detection/${file}`,
      });
      detector.setOptions({
        model: "short",
        minDetectionConfidence: 0.55,
      });

      const results = await new Promise<{
        detections: Array<{
          boundingBox: {
            xCenter: number;
            yCenter: number;
            width: number;
            height: number;
          };
        }>;
      }>((resolve, reject) => {
        detector.onResults((nextResults) => resolve(nextResults));
        detector.send({ image }).catch(reject);
      });

      await detector.close();

      const detection = results.detections[0];
      if (!detection) {
        setFaceStatus("Nenhum rosto detectado. Ajuste manualmente.");
        setCropMode("manual");
        return;
      }

      const area = createFaceCropArea(
        detection.boundingBox,
        image.naturalWidth,
        image.naturalHeight,
        PHOTO_ASPECT,
      );
      setCropMode("manual");
      setCroppedArea(area);

      if (mediaSize && cropSize) {
        const initialCrop = getInitialCropFromCroppedAreaPixels(
          area,
          mediaSize,
          0,
          cropSize,
          1,
          3,
        );
        setCrop(initialCrop.crop);
        setZoom(initialCrop.zoom);
      }

      setFaceStatus("Auto-crop ajustado pelo rosto.");
    } catch (error) {
      setFaceStatus(
        error instanceof Error
          ? error.message
          : "Falha ao detectar rosto automaticamente.",
      );
    }
  }

  const isBusy = looseMutation.isPending || zipMutation.isPending;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-950">Fotos 3x4</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Saída fixa 3x4 para uma foto ou lote selecionado.
            </p>
          </div>
          <div className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
            {PHOTO_DEFAULTS.width}x{PHOTO_DEFAULTS.height}px
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
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
              onChange={(event) => updateFiles(Array.from(event.target.files ?? []))}
            />
          </label>

          {hasFiles ? (
            <div className="overflow-hidden rounded-md border border-neutral-200">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                <span className="text-sm font-semibold text-neutral-900">
                  Arquivos
                </span>
                <button
                  type="button"
                  onClick={() => updateFiles([])}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
                >
                  <X className="size-3" aria-hidden="true" />
                  Limpar
                </button>
              </div>
              <div className="max-h-52 overflow-auto">
                {files.map((file) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-100 px-4 py-3 text-sm last:border-b-0"
                  >
                    <span className="truncate font-medium text-neutral-900">
                      {file.name}
                    </span>
                    <span className="text-neutral-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isSingle ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCropMode("auto")}
                  className={
                    cropMode === "auto"
                      ? "rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  }
                >
                  Auto-crop
                </button>
                <button
                  type="button"
                  onClick={() => setCropMode("manual")}
                  className={
                    cropMode === "manual"
                      ? "rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  }
                >
                  Recorte manual
                </button>
                <button
                  type="button"
                  onClick={detectFace}
                  disabled={!previewUrl || isBusy}
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                >
                  <ScanFace className="size-4" aria-hidden="true" />
                  Detectar rosto
                </button>
              </div>

              <div className="relative h-[min(520px,62dvh)] min-h-[320px] overflow-hidden rounded-md border border-neutral-200 bg-[var(--app-canvas)]">
                {previewUrl && cropMode === "manual" ? (
                  <Cropper
                    image={previewUrl}
                    crop={crop}
                    zoom={zoom}
                    aspect={PHOTO_ASPECT}
                    onCropChange={setCrop}
                    onCropComplete={(_, areaPixels) => setCroppedArea(areaPixels)}
                    onCropSizeChange={setCropSize}
                    onMediaLoaded={setMediaSize}
                    onZoomChange={setZoom}
                    showGrid={false}
                  />
                ) : previewUrl ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div
                      className="overflow-hidden rounded-md border border-white/70 bg-white shadow-xl"
                      style={{
                        aspectRatio: `${PHOTO_DEFAULTS.width} / ${PHOTO_DEFAULTS.height}`,
                        height: "100%",
                        maxHeight: "440px",
                      }}
                    >
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-400">
                    <ImageIcon className="size-10" aria-hidden="true" />
                  </div>
                )}
              </div>

              {cropMode === "manual" ? (
                <label className="block text-sm font-medium text-neutral-800">
                  Zoom
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                    disabled={!previewUrl}
                    className="mt-2 w-full"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {isBatch ? (
            <div className="rounded-md border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
              {files.length} fotos serão processadas em 3x4 com auto-crop.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={processLoose}
              disabled={!hasFiles || isBusy}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {looseMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Scissors className="size-4" aria-hidden="true" />
              )}
              {isBatch ? "Preparar fotos soltas" : "Processar foto"}
            </button>

            {isBatch ? (
              <button
                type="button"
                onClick={processZip}
                disabled={!hasFiles || isBusy}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
              >
                {zipMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                Baixar ZIP
              </button>
            ) : null}

            {looseResults.length > 1 ? (
              <button
                type="button"
                onClick={() => looseResults.forEach(downloadResult)}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download className="size-4" aria-hidden="true" />
                Baixar todas soltas
              </button>
            ) : null}

            {zipResult ? (
              <a
                href={zipResult.url}
                download={zipResult.fileName}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download className="size-4" aria-hidden="true" />
                ZIP pronto
              </a>
            ) : null}
          </div>

          {looseResults.length > 1 ? (
            <div className="overflow-hidden rounded-md border border-neutral-200">
              {looseResults.map((result) => (
                <a
                  key={result.url}
                  href={result.url}
                  download={result.fileName}
                  className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 text-sm last:border-b-0 hover:bg-neutral-50"
                >
                  <span className="truncate font-medium text-neutral-900">
                    {result.fileName}
                  </span>
                  <Download className="size-4 text-neutral-500" aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : null}

          {faceStatus ? (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
              {faceStatus}
            </p>
          ) : null}

          {looseMutation.isError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {looseMutation.error.message}
            </p>
          ) : null}

          {zipMutation.isError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {zipMutation.error.message}
            </p>
          ) : null}
        </div>
      </section>

      <aside className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Saída
        </h2>
        <div className="mt-4 grid gap-4">
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
              <option value="jpeg">JPEG</option>
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
              {...form.register("contrast", { valueAsNumber: true })}
              className="mt-2 w-full"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              {Number(watchedContrast || PHOTO_DEFAULTS.contrast).toFixed(2)}
            </span>
          </label>

          <label className="block text-sm font-medium text-neutral-800">
            Brilho
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              {...form.register("brightness", { valueAsNumber: true })}
              className="mt-2 w-full"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              {Number(watchedBrightness || PHOTO_DEFAULTS.brightness).toFixed(2)}
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
            Revise formato e qualidade.
          </div>
        ) : null}

        {looseResults.length === 1 ? (
          <div className="mt-5 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <img
              src={looseResults[0].url}
              alt={looseResults[0].label}
              width={previewWidth}
              height={previewHeight}
              className="mx-auto max-h-[320px] object-contain"
            />
            <a
              href={looseResults[0].url}
              download={looseResults[0].fileName}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-white"
            >
              <Download className="size-4" aria-hidden="true" />
              Baixar foto
            </a>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
