"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
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
type FilePreview = {
  file: File;
  key: string;
  url: string;
};
type EditorState = {
  crop: { x: number; y: number };
  zoom: number;
  croppedArea: Area | null;
  cropMode: CropMode;
  contrast: number;
  brightness: number;
};

const PHOTO_SETTINGS_STORAGE_KEY = "photo-3x4:settings:v2";
const PHOTO_ASPECT = PHOTO_DEFAULTS.width / PHOTO_DEFAULTS.height;
const DEFAULT_EDITOR_STATE: EditorState = {
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedArea: null,
  cropMode: "auto",
  contrast: PHOTO_DEFAULTS.contrast,
  brightness: PHOTO_DEFAULTS.brightness,
};

function getPhotoSettingsStorageKey(userId: string) {
  return `${PHOTO_SETTINGS_STORAGE_KEY}:${userId}`;
}

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

function getFileKey(file: File) {
  return file.name;
}

function getEditorState(
  states: Record<string, EditorState>,
  key: string | null,
) {
  return key ? states[key] ?? DEFAULT_EDITOR_STATE : DEFAULT_EDITOR_STATE;
}

function isSameFileName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function Photo3x4Workspace({ userId }: { userId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editorStates, setEditorStates] = useState<Record<string, EditorState>>({});
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [faceStatus, setFaceStatus] = useState<string | null>(null);
  const [isDetectingFace, setIsDetectingFace] = useState(false);
  const [looseResults, setLooseResults] = useState<ResultFile[]>([]);
  const [zipResult, setZipResult] = useState<ResultFile | null>(null);
  const restoredSettings = useRef(false);
  const photoSettingsStorageKey = getPhotoSettingsStorageKey(userId);

  const selectedFile = files[selectedIndex] ?? files[0] ?? null;
  const selectedKey = selectedFile ? getFileKey(selectedFile) : null;
  const selectedPreview = selectedKey
    ? filePreviews.find((preview) => preview.key === selectedKey)
    : null;
  const previewUrl = selectedPreview?.url ?? null;
  const selectedEditor = getEditorState(editorStates, selectedKey);
  const hasFiles = files.length > 0;
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
  const watchedAddBorder = form.watch("addBorder");
  const watchedBorderWidth = form.watch("borderWidth");
  const watchedBorderColor = form.watch("borderColor");
  const outputWidth = PHOTO_DEFAULTS.width;
  const outputHeight = PHOTO_DEFAULTS.height;
  const previewWidth = watchedAddBorder
    ? outputWidth + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputWidth;
  const previewHeight = watchedAddBorder
    ? outputHeight + Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth) * 2
    : outputHeight;
  const previewFilter = `brightness(${Number(selectedEditor.brightness || PHOTO_DEFAULTS.brightness)}) contrast(${Number(selectedEditor.contrast || PHOTO_DEFAULTS.contrast)})`;
  const previewBorderWidth = watchedAddBorder
    ? Math.max(1, Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth))
    : 0;
  const previewBorderColor = watchedBorderColor === "white" ? "#ffffff" : "#111827";
  const cropAreaBorderWidth = watchedAddBorder
    ? Math.min(14, Math.max(2, Math.round(previewBorderWidth / 2)))
    : 1;
  const cropModeDescription =
    selectedEditor.cropMode === "manual"
      ? "Recorte manual permite arrastar e aproximar a foto antes de processar."
      : "Auto-crop enquadra automaticamente a imagem em 3x4. Auto detectar rosto procura o rosto e ajusta o recorte.";

  useEffect(() => {
    try {
      const rawSettings =
        window.localStorage.getItem(photoSettingsStorageKey) ??
        window.localStorage.getItem(PHOTO_SETTINGS_STORAGE_KEY);
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
      window.localStorage.removeItem(photoSettingsStorageKey);
    } finally {
      restoredSettings.current = true;
    }
  }, [form, photoSettingsStorageKey]);

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
          photoSettingsStorageKey,
          JSON.stringify(parsed.data),
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [form, photoSettingsStorageKey]);

  useEffect(() => {
    if (files.length === 0) {
      setFilePreviews([]);
      setFaceStatus(null);
      setSelectedIndex(0);
      return undefined;
    }

    const nextPreviews = files.map((file) => ({
      file,
      key: getFileKey(file),
      url: URL.createObjectURL(file),
    }));
    setFilePreviews(nextPreviews);
    setFaceStatus(null);

    return () => {
      nextPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [files]);

  useEffect(() => {
    if (selectedIndex > files.length - 1) {
      setSelectedIndex(Math.max(0, files.length - 1));
    }
  }, [files.length, selectedIndex]);

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
    setFiles((current) => {
      const merged = [...current];
      for (const file of nextFiles) {
        const existingIndex = merged.findIndex((item) =>
          isSameFileName(item.name, file.name),
        );
        if (existingIndex >= 0) {
          merged[existingIndex] = file;
        } else {
          merged.push(file);
        }
      }

      const selectedName = current[selectedIndex]?.name;
      const nextIndex = selectedName
        ? merged.findIndex((file) => isSameFileName(file.name, selectedName))
        : 0;
      setSelectedIndex(nextIndex >= 0 ? nextIndex : Math.max(0, merged.length - 1));
      setEditorStates((currentStates) => {
        const nextStates = { ...currentStates };
        nextFiles.forEach((file) => {
          delete nextStates[getFileKey(file)];
        });
        return nextStates;
      });

      return merged;
    });
  }

  function clearFiles() {
    clearResults();
    setFiles([]);
    setEditorStates({});
    setSelectedIndex(0);
  }

  function setSelectedEditorState(nextState: Partial<EditorState>) {
    if (!selectedKey) {
      return;
    }

    clearResults();
    setEditorStates((current) => ({
      ...current,
      [selectedKey]: {
        ...getEditorState(current, selectedKey),
        ...nextState,
      },
    }));
  }

  function goToPhoto(direction: -1 | 1) {
    if (files.length <= 1) {
      return;
    }

    setSelectedIndex((current) => {
      const next = current + direction;
      if (next < 0) {
        return files.length - 1;
      }
      if (next >= files.length) {
        return 0;
      }
      return next;
    });
  }

  function resetAdjustments() {
    clearResults();
    setFaceStatus(null);
    setIsDetectingFace(false);
    setMediaSize(null);
    setCropSize(null);

    if (selectedKey) {
      setEditorStates((current) => {
        const nextStates = { ...current };
        delete nextStates[selectedKey];
        return nextStates;
      });
      return;
    }

    form.reset({
      ...PHOTO_DEFAULTS,
      format: "jpeg",
      replaceOriginal: true,
      convertToJpg: false,
    });
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
        const state = getEditorState(editorStates, getFileKey(file));
        nextResults.push(
          await processOne(
            file,
            {
              ...values,
              contrast: state.contrast,
              brightness: state.brightness,
            },
            state.croppedArea,
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

      const processed: ResultFile[] = [];
      for (const file of files) {
        const state = getEditorState(editorStates, getFileKey(file));
        processed.push(
          await processOne(
            file,
            {
              ...values,
              contrast: state.contrast,
              brightness: state.brightness,
            },
            state.croppedArea,
          ),
        );
      }

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const result of processed) {
        zip.file(result.fileName, await (await fetch(result.url)).blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      revokeResultUrls(processed);

      return {
        url: URL.createObjectURL(blob),
        fileName: "fotos-3x4.zip",
        label: `${processed.length} foto${processed.length > 1 ? "s" : ""} processada${processed.length > 1 ? "s" : ""}`,
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

  function waitForPaint() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Detecção demorou demais. Tente novamente ou use o recorte manual.")),
          timeoutMs,
        );
      }),
    ]);
  }

  async function detectFace() {
    if (!previewUrl) {
      setFaceStatus("Selecione uma foto primeiro.");
      return;
    }
    if (isDetectingFace) {
      return;
    }

    setIsDetectingFace(true);
    setFaceStatus("Detectando rosto...");
    await waitForPaint();

    let detector:
      | {
          setOptions: (options: {
            model: "short";
            minDetectionConfidence: number;
          }) => void;
          onResults: (listener: (results: {
            detections: Array<{
              boundingBox: {
                xCenter: number;
                yCenter: number;
                width: number;
                height: number;
              };
            }>;
          }) => void) => void;
          send: (input: { image: HTMLImageElement }) => Promise<void>;
          close: () => Promise<void>;
        }
      | null = null;
    try {
      const image = await loadImage(previewUrl);
      const { FaceDetection } = await import("@mediapipe/face_detection");
      detector = new FaceDetection({
        locateFile: (file) => `/mediapipe/face_detection/${file}`,
      });
      detector.setOptions({
        model: "short",
        minDetectionConfidence: 0.55,
      });

      const results = await withTimeout(
        new Promise<{
          detections: Array<{
            boundingBox: {
              xCenter: number;
              yCenter: number;
              width: number;
              height: number;
            };
          }>;
        }>((resolve, reject) => {
          detector?.onResults((nextResults) => resolve(nextResults));
          detector?.send({ image }).catch(reject);
        }),
        12_000,
      );

      const detection = results.detections[0];
      if (!detection) {
        setFaceStatus("Nenhum rosto detectado. Ajuste manualmente.");
        setSelectedEditorState({ cropMode: "manual" });
        return;
      }

      const area = createFaceCropArea(
        detection.boundingBox,
        image.naturalWidth,
        image.naturalHeight,
        PHOTO_ASPECT,
      );
      setSelectedEditorState({ cropMode: "manual", croppedArea: area });

      if (mediaSize && cropSize) {
        const initialCrop = getInitialCropFromCroppedAreaPixels(
          area,
          mediaSize,
          0,
          cropSize,
          1,
          3,
        );
        setSelectedEditorState({
          crop: initialCrop.crop,
          zoom: initialCrop.zoom,
          croppedArea: area,
          cropMode: "manual",
        });
      }

      setFaceStatus("Auto-crop ajustado pelo rosto.");
    } catch (error) {
      setFaceStatus(
        error instanceof Error
          ? error.message
          : "Falha ao detectar rosto automaticamente.",
      );
    } finally {
      await detector?.close().catch(() => {});
      setIsDetectingFace(false);
    }
  }

  const isBusy = looseMutation.isPending || zipMutation.isPending || isDetectingFace;

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
              onChange={(event) => {
                updateFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>

          {hasFiles ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
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
                      className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
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
                      className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                      aria-label="Próxima foto"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEditorState({ cropMode: "auto" })}
                  className={
                    selectedEditor.cropMode === "auto"
                      ? "rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  }
                >
                  Auto-crop
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEditorState({ cropMode: "manual" })}
                  className={
                    selectedEditor.cropMode === "manual"
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
                  {isDetectingFace ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ScanFace className="size-4" aria-hidden="true" />
                  )}
                  {isDetectingFace ? "Detectando..." : "Auto detectar rosto"}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                {cropModeDescription}
              </p>

              <div className="relative h-[min(520px,62dvh)] min-h-[320px] overflow-hidden rounded-md border border-neutral-200 bg-[var(--app-canvas)]">
                {previewUrl && selectedEditor.cropMode === "manual" ? (
                  <Cropper
                    image={previewUrl}
                    crop={selectedEditor.crop}
                    zoom={selectedEditor.zoom}
                    aspect={PHOTO_ASPECT}
                    onCropChange={(nextCrop) =>
                      setSelectedEditorState({ crop: nextCrop })
                    }
                    onCropComplete={(_, areaPixels) =>
                      setSelectedEditorState({ croppedArea: areaPixels })
                    }
                    onCropSizeChange={setCropSize}
                    onMediaLoaded={setMediaSize}
                    onZoomChange={(nextZoom) =>
                      setSelectedEditorState({ zoom: nextZoom })
                    }
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

              <div className="overflow-hidden rounded-md border border-neutral-200">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                  <span className="text-sm font-semibold text-neutral-900">
                    Arquivos
                  </span>
                  <button
                    type="button"
                    onClick={clearFiles}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
                  >
                    <X className="size-3" aria-hidden="true" />
                    Limpar
                  </button>
                </div>
                <div className="max-h-52 overflow-auto">
                  {files.map((file, index) => (
                    <button
                      type="button"
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      onClick={() => setSelectedIndex(index)}
                      className={
                        index === selectedIndex
                          ? "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-900 bg-neutral-950 px-4 py-3 text-left text-sm text-white last:border-b-0"
                          : "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-neutral-50"
                      }
                    >
                      <span
                        className={
                          index === selectedIndex
                            ? "truncate font-medium text-white"
                            : "truncate font-medium text-neutral-900"
                        }
                      >
                        {file.name}
                      </span>
                      <span
                        className={
                          index === selectedIndex ? "text-neutral-200" : "text-neutral-500"
                        }
                      >
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
              {isBatch ? "Processar lote" : "Processar foto"}
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
