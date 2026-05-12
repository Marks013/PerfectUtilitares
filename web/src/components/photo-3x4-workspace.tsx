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
  type Area,
  type MediaSize,
  type Size,
} from "react-easy-crop";
import { useForm } from "react-hook-form";
import { getPendingFaceCropInitialization } from "@/lib/photos/editor-crop";
import { createFaceCropArea } from "@/lib/photos/face-crop";
import {
  PHOTO_DEFAULTS,
  photoSettingsSchema,
  type PhotoSettings,
  type PhotoSettingsInput,
} from "@/lib/photos/schema";

type ResultFile = {
  url: string;
  blob: Blob;
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
  pendingFaceArea: Area | null;
  cropMode: CropMode;
  contrast: number;
  brightness: number;
};
type WorkProgress = {
  kind: "detect" | "process" | "zip";
  current: number;
  total: number;
  label: string;
  detail?: string;
} | null;
type WorkPreview = FilePreview | null;
type CropGeometry = {
  key: string | null;
  mediaSize: MediaSize | null;
  cropSize: Size | null;
};
type FaceDetectionResult = {
  detections: Array<{
    boundingBox: {
      xCenter: number;
      yCenter: number;
      width: number;
      height: number;
    };
  }>;
  imageWidth: number;
  imageHeight: number;
};
type FaceDetectionFrameMessage = {
  type?: string;
  requestId?: string;
  ok?: boolean;
  result?: FaceDetectionResult;
  error?: string;
};

const PHOTO_SETTINGS_STORAGE_KEY = "photo-3x4:settings:v2";
const PHOTO_ASPECT = PHOTO_DEFAULTS.width / PHOTO_DEFAULTS.height;
const FACE_DETECTION_FRAME_SRC = "/mediapipe/face-detection-frame.html";
const DEFAULT_EDITOR_STATE: EditorState = {
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedArea: null,
  pendingFaceArea: null,
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

    return (
      data.error?.message ??
      "Não foi possível processar a imagem. Revise a foto e tente novamente."
    );
  } catch {
    return "Não foi possível processar a imagem. Revise a foto e tente novamente.";
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

function appendBatchCrops(
  formData: FormData,
  files: File[],
  editorStates: Record<string, EditorState>,
) {
  const crops = files.reduce<Record<string, Area>>((current, file) => {
    const crop = getEditorState(editorStates, getFileKey(file)).croppedArea;
    if (crop) {
      current[file.name] = crop;
    }
    return current;
  }, {});

  if (Object.keys(crops).length > 0) {
    formData.set("crops", JSON.stringify(crops));
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "Não foi possível pré-visualizar a foto. Verifique se o arquivo é JPG, PNG ou WEBP.",
        ),
      );
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

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getFileKey(file: File) {
  return file.name;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function detectFaceInFrame(file: File, timeoutMs: number) {
  return new Promise<FaceDetectionResult>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    const requestId = createRequestId();
    let settled = false;
    let timeout = 0;

    function cleanup() {
      window.removeEventListener("message", handleMessage);
      iframe.remove();
    }

    function finish() {
      if (settled) {
        return false;
      }

      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      return true;
    }

    function finishSuccess(result: FaceDetectionResult) {
      if (finish()) {
        resolve(result);
      }
    }

    function finishError(error: Error) {
      if (finish()) {
        reject(error);
      }
    }

    function handleMessage(event: MessageEvent<FaceDetectionFrameMessage>) {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframe.contentWindow ||
        event.data?.type !== "photo-3x4:face-detection-result" ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      if (event.data.ok && event.data.result) {
        finishSuccess(event.data.result);
        return;
      }

      finishError(
        new Error(event.data.error ?? "Falha ao detectar rosto automaticamente."),
      );
    }

    timeout = window.setTimeout(() => {
      finishError(
        new Error("Detecção demorou demais. Tente novamente ou use o recorte manual."),
      );
    }, timeoutMs);

    iframe.onload = () => {
      iframe.contentWindow?.postMessage(
        {
          type: "photo-3x4:detect-face",
          requestId,
          file,
        },
        window.location.origin,
      );
    };
    iframe.onerror = () => {
      finishError(new Error("Não foi possível carregar a detecção de rosto."));
    };
    iframe.src = FACE_DETECTION_FRAME_SRC;
    iframe.title = "Detecção de rosto";
    iframe.tabIndex = -1;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.display = "none";

    window.addEventListener("message", handleMessage);
    document.body.appendChild(iframe);
  });
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

function getPhotoFormErrorMessages(errors: Record<string, unknown>) {
  const messages = Object.values(errors)
    .map((error) => {
      if (!error || typeof error !== "object" || !("message" in error)) {
        return null;
      }

      const message = (error as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    })
    .filter((message): message is string => Boolean(message));

  return messages.length
    ? messages
    : ["Revise formato, qualidade e borda antes de processar."];
}

export function Photo3x4Workspace({ userId }: { userId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editorStates, setEditorStates] = useState<Record<string, EditorState>>({});
  const [cropGeometry, setCropGeometry] = useState<CropGeometry>({
    key: null,
    mediaSize: null,
    cropSize: null,
  });
  const [faceStatus, setFaceStatus] = useState<string | null>(null);
  const [isDetectingFace, setIsDetectingFace] = useState(false);
  const [isDetectingBatchFaces, setIsDetectingBatchFaces] = useState(false);
  const [workProgress, setWorkProgress] = useState<WorkProgress>(null);
  const [workPreview, setWorkPreview] = useState<WorkPreview>(null);
  const [isDownloadingLooseResults, setIsDownloadingLooseResults] = useState(false);
  const [looseDownloadStatus, setLooseDownloadStatus] = useState<string | null>(null);
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
  const visibleEditor = workPreview
    ? getEditorState(editorStates, workPreview.key)
    : selectedEditor;
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
  const previewFilter = `brightness(${Number(visibleEditor.brightness || PHOTO_DEFAULTS.brightness)}) contrast(${Number(visibleEditor.contrast || PHOTO_DEFAULTS.contrast)})`;
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
  const progressPercent = workProgress
    ? Math.round((workProgress.current / Math.max(1, workProgress.total)) * 100)
    : 0;

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
    setFaceStatus(null);
    setCropGeometry({ key: selectedKey, mediaSize: null, cropSize: null });
  }, [selectedKey]);

  useEffect(() => {
    return () => {
      revokeResultUrls(looseResults);
      if (zipResult) {
        URL.revokeObjectURL(zipResult.url);
      }
    };
  }, [looseResults, zipResult]);

  useEffect(() => {
    if (
      !selectedKey ||
      selectedEditor.cropMode !== "manual" ||
      !selectedEditor.pendingFaceArea ||
      cropGeometry.key !== selectedKey ||
      !cropGeometry.mediaSize ||
      !cropGeometry.cropSize
    ) {
      return;
    }

    const initialCrop = getPendingFaceCropInitialization({
      selectedKey,
      cropMode: selectedEditor.cropMode,
      pendingFaceArea: selectedEditor.pendingFaceArea,
      geometry: cropGeometry,
    });
    if (!initialCrop) return;

    setEditorStateForKey(selectedKey, {
      crop: initialCrop.crop,
      zoom: initialCrop.zoom,
      croppedArea: selectedEditor.pendingFaceArea,
      pendingFaceArea: null,
    });
  }, [
    cropGeometry,
    selectedEditor.cropMode,
    selectedEditor.pendingFaceArea,
    selectedKey,
  ]);

  function clearResults() {
    revokeResultUrls(looseResults);
    setLooseResults([]);
    setLooseDownloadStatus(null);
    setIsDownloadingLooseResults(false);
    if (zipResult) {
      URL.revokeObjectURL(zipResult.url);
      setZipResult(null);
    }
  }

  function updateFiles(nextFiles: File[]) {
    clearResults();
    setWorkProgress(null);
    setWorkPreview(null);
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
    setWorkProgress(null);
    setWorkPreview(null);
    setFiles([]);
    setEditorStates({});
    setSelectedIndex(0);
    setCropGeometry({ key: null, mediaSize: null, cropSize: null });
  }

  function setSelectedEditorState(nextState: Partial<EditorState>) {
    if (!selectedKey) {
      return;
    }

    clearResults();
    setWorkProgress(null);
    setWorkPreview(null);
    setEditorStateForKey(selectedKey, nextState);
  }

  function getPreviewForFile(file: File) {
    const key = getFileKey(file);
    return filePreviews.find((preview) => preview.key === key) ?? null;
  }

  async function downloadLooseResults() {
    if (isDownloadingLooseResults || looseResults.length === 0) {
      return;
    }

    setIsDownloadingLooseResults(true);
    try {
      for (let index = 0; index < looseResults.length; index += 1) {
        const result = looseResults[index];
        setLooseDownloadStatus(
          `Enviando download ${index + 1}/${looseResults.length}: ${result.fileName}`,
        );
        downloadResult(result);
        await wait(450);
      }
      setLooseDownloadStatus(
        `Solicitação enviada para ${looseResults.length} foto(s). Se o navegador bloquear downloads múltiplos, permita os downloads do site ou use os links individuais abaixo.`,
      );
    } finally {
      setIsDownloadingLooseResults(false);
    }
  }

  function setEditorStateForKey(key: string, nextState: Partial<EditorState>) {
    setEditorStates((current) => ({
      ...current,
      [key]: {
        ...getEditorState(current, key),
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
    setIsDetectingBatchFaces(false);
    setWorkProgress(null);
    setCropGeometry({ key: null, mediaSize: null, cropSize: null });

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
      blob,
      fileName: getDownloadFileName(response, "foto-3x4.jpg"),
      label: file.name,
    };
  }

  async function processBatchZip(values: PhotoSettings) {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    appendSettings(formData, values);
    appendBatchCrops(formData, files, editorStates);

    const response = await fetch("/api/fotos/lote", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const blob = await response.blob();
    return {
      blob,
      fileName: getDownloadFileName(response, "fotos-3x4.zip"),
      label: `${files.length} foto${files.length > 1 ? "s" : ""} processada${files.length > 1 ? "s" : ""}`,
    };
  }

  async function createLooseResultsFromZip(zipBlob: Blob) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const results: ResultFile[] = [];

    for (const entry of entries) {
      const blob = await entry.async("blob");
      results.push({
        url: URL.createObjectURL(blob),
        blob,
        fileName: entry.name,
        label: entry.name,
      });
    }

    return results;
  }

  const looseMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (!hasFiles) {
        throw new Error("Selecione ao menos uma foto JPG, PNG ou WEBP.");
      }

      if (files.length > 1) {
        setWorkPreview(getPreviewForFile(files[0]));
        setWorkProgress({
          kind: "process",
          current: 1,
          total: 1,
          label: "Gerando fotos soltas",
          detail: `${files.length} foto${files.length > 1 ? "s" : ""}`,
        });
        const zip = await processBatchZip(values);
        return createLooseResultsFromZip(zip.blob);
      }

      const nextResults: ResultFile[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setWorkPreview(getPreviewForFile(file));
        setWorkProgress({
          kind: "process",
          current: index + 1,
          total: files.length,
          label: isBatch ? "Processando lote" : "Processando foto",
          detail: file.name,
        });
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
      setWorkPreview(null);
      setLooseResults(results);
      setWorkProgress({
        kind: "process",
        current: results.length,
        total: results.length,
        label: "Processamento concluído",
        detail: `${results.length} foto${results.length > 1 ? "s" : ""} pronta${results.length > 1 ? "s" : ""}`,
      });
      if (results.length === 1) {
        downloadResult(results[0]);
      }
    },
    onError() {
      setWorkProgress(null);
      setWorkPreview(null);
    },
  });

  const zipMutation = useMutation({
    mutationFn: async (values: PhotoSettings) => {
      if (!hasFiles) {
        throw new Error("Selecione ao menos uma foto JPG, PNG ou WEBP.");
      }

      setWorkPreview(getPreviewForFile(files[0]));
      setWorkProgress({
        kind: "zip",
        current: 1,
        total: 1,
        label: "Preparando ZIP",
        detail: `${files.length} foto${files.length > 1 ? "s" : ""}`,
      });
      const zip = await processBatchZip(values);

      return {
        url: URL.createObjectURL(zip.blob),
        blob: zip.blob,
        fileName: zip.fileName,
        label: zip.label,
      };
    },
    onSuccess(result) {
      if (zipResult) {
        URL.revokeObjectURL(zipResult.url);
      }
      setWorkPreview(null);
      setZipResult(result);
      setWorkProgress({
        kind: "zip",
        current: files.length,
        total: files.length,
        label: "ZIP concluído",
        detail: result.label,
      });
      downloadResult(result);
    },
    onError() {
      setWorkProgress(null);
      setWorkPreview(null);
    },
  });

  const processLoose = form.handleSubmit((values) => looseMutation.mutate(values));
  const processZip = form.handleSubmit((values) => zipMutation.mutate(values));

  function waitForPaint() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async function createFaceDetectionCrop(file: File, previewUrlForFile?: string) {
    const results = await detectFaceInFrame(file, 12_000);
    const detection = results.detections[0];
    if (!detection) {
      throw new Error(
        "Nenhum rosto foi detectado nesta foto. Use o recorte manual ou escolha uma imagem com o rosto mais centralizado e visível.",
      );
    }

    let imageWidth = results.imageWidth;
    let imageHeight = results.imageHeight;
    if ((!imageWidth || !imageHeight) && previewUrlForFile) {
      const image = await loadImage(previewUrlForFile);
      imageWidth = image.naturalWidth;
      imageHeight = image.naturalHeight;
    }

    if (!imageWidth || !imageHeight) {
      throw new Error("Não foi possível calcular o tamanho da foto detectada.");
    }

    return createFaceCropArea(
      detection.boundingBox,
      imageWidth,
      imageHeight,
      PHOTO_ASPECT,
    );
  }

  function createDetectedEditorState(key: string, area: Area): Partial<EditorState> {
    const nextState: Partial<EditorState> = {
      cropMode: "manual",
      croppedArea: area,
      pendingFaceArea: area,
    };

    if (
      cropGeometry.key === key &&
      cropGeometry.mediaSize &&
      cropGeometry.cropSize
    ) {
      const initialCrop = getPendingFaceCropInitialization({
        selectedKey: key,
        cropMode: "manual",
        pendingFaceArea: area,
        geometry: cropGeometry,
      });
      if (!initialCrop) return nextState;

      nextState.crop = initialCrop.crop;
      nextState.zoom = initialCrop.zoom;
      nextState.pendingFaceArea = null;
    }

    return nextState;
  }

  async function detectFace() {
    if (!previewUrl || !selectedFile || !selectedKey) {
      setFaceStatus("Selecione uma foto primeiro para usar a detecção de rosto.");
      return;
    }
    if (isDetectingFace) {
      return;
    }

    setIsDetectingFace(true);
    setWorkPreview(selectedPreview ?? null);
    setWorkProgress({
      kind: "detect",
      current: 1,
      total: 1,
      label: "Detectando rosto",
      detail: selectedFile.name,
    });
    setFaceStatus("Detectando rosto...");
    const detectionKey = selectedKey;
    const detectionFile = selectedFile;
    const detectionPreviewUrl = previewUrl;
    await waitForPaint();

    try {
      const area = await createFaceDetectionCrop(
        detectionFile,
        detectionPreviewUrl,
      );
      clearResults();
      setEditorStateForKey(detectionKey, createDetectedEditorState(detectionKey, area));
      setWorkProgress({
        kind: "detect",
        current: 1,
        total: 1,
        label: "Rosto detectado",
        detail: detectionFile.name,
      });
      setFaceStatus("Rosto detectado. O recorte foi ajustado automaticamente.");
    } catch (error) {
      setWorkProgress(null);
      setWorkPreview(null);
      setFaceStatus(
        error instanceof Error
          ? error.message
          : "Falha ao detectar rosto automaticamente.",
      );
    } finally {
      setWorkPreview(null);
      setIsDetectingFace(false);
    }
  }

  async function detectFacesInBatch() {
    if (!hasFiles) {
      setFaceStatus("Selecione fotos primeiro para usar a detecção em lote.");
      return;
    }
    if (isDetectingBatchFaces) {
      return;
    }

    clearResults();
    setIsDetectingBatchFaces(true);
    const nextEditorStates: Record<string, EditorState> = { ...editorStates };
    setFaceStatus(`Detectando rostos em lote: 0/${files.length}`);
    setWorkProgress({
      kind: "detect",
      current: 0,
      total: files.length,
      label: "Auto-detecção em lote",
      detail: "Preparando fotos",
    });
    await waitForPaint();

    let detectedCount = 0;
    const failedNames: string[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const key = getFileKey(file);
        const previewForFile = getPreviewForFile(file);
        setWorkPreview(previewForFile);
        setWorkProgress({
          kind: "detect",
          current: index + 1,
          total: files.length,
          label: "Auto-detecção em lote",
          detail: file.name,
        });
        setFaceStatus(
          `Detectando rostos em lote: ${index + 1}/${files.length} - ${file.name}`,
        );

        try {
          const area = await createFaceDetectionCrop(file, previewForFile?.url);
          nextEditorStates[key] = {
            ...getEditorState(nextEditorStates, key),
            ...createDetectedEditorState(key, area),
          };
          detectedCount += 1;
        } catch {
          failedNames.push(file.name);
        }
      }

      setEditorStates(nextEditorStates);
      setFaceStatus(
        failedNames.length
          ? `Auto-detecção em lote concluída: ${detectedCount}/${files.length} foto(s) ajustada(s). Sem rosto detectado em: ${failedNames.join(", ")}.`
          : `Auto-detecção em lote concluída: ${detectedCount}/${files.length} foto(s) ajustada(s). Revise a pré-visualização antes de processar.`,
      );
      setWorkProgress({
        kind: "detect",
        current: files.length,
        total: files.length,
        label: "Auto-detecção concluída",
        detail: `${detectedCount}/${files.length} foto${files.length > 1 ? "s" : ""} ajustada${detectedCount !== 1 ? "s" : ""}`,
      });
    } finally {
      setWorkPreview(null);
      setIsDetectingBatchFaces(false);
    }
  }

  const isBusy =
    looseMutation.isPending ||
    zipMutation.isPending ||
    isDetectingFace ||
    isDetectingBatchFaces;

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
                  looseMutation.isPending ||
                  zipMutation.isPending) ? (
                  <div className="photo-preview-overlay" aria-hidden="true">
                    <Loader2 className="size-8 animate-spin" />
                    <span>{workProgress.label}</span>
                    {workProgress.detail ? <small>{workProgress.detail}</small> : null}
                  </div>
                ) : null}
                {workPreview ? (
                  <div className="flex h-full items-center justify-center p-6">
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
                    const fileState = getEditorState(editorStates, getFileKey(file));
                    const hasFaceCrop =
                      fileState.cropMode === "manual" && Boolean(fileState.croppedArea);
                    return (
                      <button
                        type="button"
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        onClick={() => setSelectedIndex(index)}
                        className={
                          index === selectedIndex
                            ? "photo-file-row photo-file-row--active"
                            : "photo-file-row"
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
                            index === selectedIndex
                              ? "photo-file-row__meta text-neutral-200"
                              : "photo-file-row__meta text-neutral-500"
                          }
                        >
                          {hasFaceCrop ? <small>Rosto detectado</small> : null}
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className="photo-actions">
            <button
              type="button"
              onClick={processLoose}
              disabled={!hasFiles || isBusy}
              className="photo-primary-button"
            >
              {looseMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Scissors className="size-4" aria-hidden="true" />
              )}
              {looseMutation.isPending
                ? isBatch
                  ? "Gerando soltas..."
                  : "Processando..."
                : isBatch
                  ? "Gerar fotos soltas"
                  : "Processar foto"}
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

            {looseResults.length > 1 ? (
              <button
                type="button"
                onClick={downloadLooseResults}
                disabled={isDownloadingLooseResults}
                className="photo-secondary-button"
              >
                {isDownloadingLooseResults ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                Baixar todas soltas ({looseResults.length})
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

          {looseDownloadStatus ? (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
              {looseDownloadStatus}
            </p>
          ) : null}

          {looseResults.length > 1 ? (
            <div className="overflow-hidden rounded-md border border-neutral-200">
              <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-900">
                {looseResults.length} foto(s) processada(s) para download individual
              </div>
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
            <p className="font-medium">Revise as configurações da foto:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {getPhotoFormErrorMessages(form.formState.errors).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
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
