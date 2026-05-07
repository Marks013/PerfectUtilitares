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
} from "lucide-react";
import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";
import Cropper, {
  getInitialCropFromCroppedAreaPixels,
  type Area,
  type MediaSize,
  type Size,
} from "react-easy-crop";
import { useForm } from "react-hook-form";
import {
  PHOTO_DEFAULTS,
  photoSettingsSchema,
  type PhotoSettingsInput,
  type PhotoSettings,
} from "@/lib/photos/schema";
import { createFaceCropArea } from "@/lib/photos/face-crop";

type ResultFile = {
  url: string;
  fileName: string;
  label: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

const PHOTO_SETTINGS_STORAGE_KEY = "photo-3x4:settings:v1";

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
  formData.set("width", String(values.width));
  formData.set("height", String(values.height));
  formData.set("quality", String(values.quality));
  formData.set("format", values.format);
  formData.set("contrast", String(values.contrast));
  formData.set("brightness", String(values.brightness));
  formData.set("addBorder", String(values.addBorder));
  formData.set("borderWidth", String(values.borderWidth));
  formData.set("borderColor", values.borderColor);
  formData.set("replaceOriginal", String(values.replaceOriginal));
  formData.set("convertToJpg", String(values.convertToJpg));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    image.src = url;
  });
}

export function Photo3x4Workspace() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [faceStatus, setFaceStatus] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<ResultFile | null>(null);
  const [batchResult, setBatchResult] = useState<ResultFile | null>(null);
  const singleResultUrl = useRef<string | null>(null);
  const batchResultUrl = useRef<string | null>(null);
  const restoredSettings = useRef(false);

  const form = useForm<PhotoSettingsInput, unknown, PhotoSettings>({
    resolver: zodResolver(photoSettingsSchema),
    defaultValues: PHOTO_DEFAULTS,
  });

  const watchedWidth = form.watch("width");
  const watchedHeight = form.watch("height");
  const watchedQuality = form.watch("quality");
  const watchedContrast = form.watch("contrast");
  const watchedBrightness = form.watch("brightness");
  const watchedAddBorder = form.watch("addBorder");
  const watchedBorderWidth = form.watch("borderWidth");
  const watchedConvertToJpg = Boolean(form.watch("convertToJpg"));
  const outputWidth = Number(watchedWidth || PHOTO_DEFAULTS.width);
  const outputHeight = Number(watchedHeight || PHOTO_DEFAULTS.height);
  const previewWidth = watchedAddBorder
    ? outputWidth + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputWidth;
  const previewHeight = watchedAddBorder
    ? outputHeight + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputHeight;
  const aspect = outputWidth / outputHeight;

  useEffect(() => {
    try {
      const rawSettings = window.localStorage.getItem(PHOTO_SETTINGS_STORAGE_KEY);
      if (rawSettings) {
        const parsed = photoSettingsSchema.safeParse(JSON.parse(rawSettings));
        if (parsed.success) {
          form.reset(parsed.data);
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

      const parsed = photoSettingsSchema.safeParse(values);
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
    if (watchedConvertToJpg && form.getValues("format") !== "jpeg") {
      form.setValue("format", "jpeg", { shouldDirty: true });
    }
  }, [form, watchedConvertToJpg]);

  useEffect(() => {
    if (!singleFile) {
      setPreviewUrl(null);
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(singleFile);
    setPreviewUrl(nextPreviewUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setFaceStatus(null);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [singleFile]);

  useEffect(() => {
    return () => {
      if (singleResultUrl.current) {
        URL.revokeObjectURL(singleResultUrl.current);
      }
      if (batchResultUrl.current) {
        URL.revokeObjectURL(batchResultUrl.current);
      }
    };
  }, []);

  const singleMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (!singleFile) {
        throw new Error("Selecione uma foto");
      }

      const formData = new FormData();
      formData.set("file", singleFile);
      appendSettings(formData, values);

      if (croppedArea) {
        formData.set("crop", JSON.stringify(croppedArea));
      }

      const response = await fetch("/api/fotos/processar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const blob = await response.blob();
      const fileName = getDownloadFileName(response, "foto-3x4.jpeg");
      const url = URL.createObjectURL(blob);

      if (singleResultUrl.current) {
        URL.revokeObjectURL(singleResultUrl.current);
      }

      singleResultUrl.current = url;
      setSingleResult({ url, fileName, label: "Imagem pronta" });
    },
  });

  const batchMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (batchFiles.length === 0) {
        throw new Error("Selecione ao menos uma foto");
      }

      const formData = new FormData();
      batchFiles.forEach((file) => formData.append("files", file));
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
      const url = URL.createObjectURL(blob);

      if (batchResultUrl.current) {
        URL.revokeObjectURL(batchResultUrl.current);
      }

      batchResultUrl.current = url;
      setBatchResult({
        url,
        fileName: "fotos-3x4.zip",
        label: `${processed} processadas, ${errors} ignoradas`,
      });
    },
  });

  const submitSingle = form.handleSubmit((values) => singleMutation.mutate(values));
  const submitBatch = form.handleSubmit((values) => batchMutation.mutate(values));

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
        return;
      }

      const area = createFaceCropArea(
        detection.boundingBox,
        image.naturalWidth,
        image.naturalHeight,
        aspect,
      );
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

      setFaceStatus("Rosto detectado e corte ajustado.");
    } catch (error) {
      setFaceStatus(
        error instanceof Error
          ? error.message
          : "Falha ao detectar rosto automaticamente.",
      );
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-950">Fotos 3x4</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Corte, redimensionamento e exportação.
            </p>
          </div>
          <div className="grid grid-cols-2 rounded-md border border-neutral-200 p-1">
            <button
              type="button"
              onClick={() => setMode("single")}
              className={
                mode === "single"
                  ? "rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
                  : "rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              }
            >
              Individual
            </button>
            <button
              type="button"
              onClick={() => setMode("batch")}
              className={
                mode === "batch"
                  ? "rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
                  : "rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              }
            >
              Lote
            </button>
          </div>
        </div>

        {mode === "single" ? (
          <div className="mt-5 space-y-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              <Upload className="size-4" aria-hidden="true" />
              <span>{singleFile ? singleFile.name : "Selecionar foto"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  setSingleFile(event.target.files?.[0] ?? null);
                  setSingleResult(null);
                }}
              />
            </label>

            <div className="relative h-[min(520px,62dvh)] min-h-[320px] overflow-hidden rounded-md border border-neutral-200 bg-[var(--app-canvas)]">
              {previewUrl ? (
                <Cropper
                  image={previewUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={aspect}
                  onCropChange={setCrop}
                  onCropComplete={(_, areaPixels) => setCroppedArea(areaPixels)}
                  onCropSizeChange={setCropSize}
                  onMediaLoaded={setMediaSize}
                  onZoomChange={setZoom}
                  showGrid={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-neutral-400">
                  <ImageIcon className="size-10" aria-hidden="true" />
                </div>
              )}
            </div>

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

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={detectFace}
                disabled={!previewUrl || singleMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
              >
                <ScanFace className="size-4" aria-hidden="true" />
                Detectar rosto
              </button>
              <button
                type="button"
                onClick={submitSingle}
                disabled={singleMutation.isPending || !singleFile}
                className="inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                {singleMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Scissors className="size-4" aria-hidden="true" />
                )}
                Processar
              </button>

              {singleResult ? (
                <a
                  href={singleResult.url}
                  download={singleResult.fileName}
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download
                </a>
              ) : null}
            </div>

            {faceStatus ? (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                {faceStatus}
              </p>
            ) : null}

            {singleMutation.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {singleMutation.error.message}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              <Upload className="size-4" aria-hidden="true" />
              <span>{batchFiles.length ? `${batchFiles.length} fotos` : "Selecionar lote"}</span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  setBatchFiles(Array.from(event.target.files ?? []));
                  setBatchResult(null);
                }}
              />
            </label>

            <div className="overflow-hidden rounded-md border border-neutral-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-4 py-3">Arquivo</th>
                    <th className="px-4 py-3">Tamanho</th>
                  </tr>
                </thead>
                <tbody>
                  {batchFiles.slice(0, 12).map((file) => (
                    <tr key={`${file.name}-${file.size}`} className="border-t border-neutral-100">
                      <td className="px-4 py-3 font-medium text-neutral-900">{file.name}</td>
                      <td className="px-4 py-3 text-neutral-600">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </td>
                    </tr>
                  ))}
                  {batchFiles.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={2}>
                        Nenhum arquivo selecionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={submitBatch}
                disabled={batchMutation.isPending || batchFiles.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                {batchMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                Gerar ZIP
              </button>

              {batchResult ? (
                <a
                  href={batchResult.url}
                  download={batchResult.fileName}
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <Download className="size-4" aria-hidden="true" />
                  ZIP
                </a>
              ) : null}
            </div>

            {batchResult ? (
              <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                {batchResult.label}
              </p>
            ) : null}

            {batchMutation.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {batchMutation.error.message}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <aside className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Saída
        </h2>
        <div className="mt-4 grid gap-4">
          <label className="block text-sm font-medium text-neutral-800">
            Largura
            <input
              type="number"
              min={100}
              max={2400}
              {...form.register("width", { valueAsNumber: true })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            />
          </label>
          <label className="block text-sm font-medium text-neutral-800">
            Altura
            <input
              type="number"
              min={100}
              max={2400}
              {...form.register("height", { valueAsNumber: true })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            />
          </label>
          <label className="block text-sm font-medium text-neutral-800">
            Formato
            <select
              {...form.register("format")}
              disabled={watchedConvertToJpg}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            >
              <option value="original">Original</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              {...form.register("replaceOriginal")}
              className="size-4 rounded border-neutral-300"
            />
            Substituir original
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              {...form.register("convertToJpg")}
              className="size-4 rounded border-neutral-300"
            />
            Converter para JPG
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
            Revise largura, altura e qualidade.
          </div>
        ) : null}

        {singleResult && mode === "single" ? (
          <div className="mt-5 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <NextImage
              src={singleResult.url}
              alt={singleResult.label}
              width={previewWidth}
              height={previewHeight}
              unoptimized
              className="mx-auto max-h-[320px] object-contain"
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
