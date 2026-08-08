"use client";

import type {
  Area,
  MediaSize,
  Size,
} from "react-easy-crop";
import {
  PHOTO_DEFAULTS,
  type PhotoSettings,
} from "@/lib/photos/schema";
export type ResultFile = {
  url: string;
  blob: Blob;
  fileName: string;
  label: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

type CropMode = "auto" | "manual";
export type FilePreview = {
  file: File;
  key: string;
  url: string;
};
export type EditorState = {
  crop: { x: number; y: number };
  zoom: number;
  croppedArea: Area | null;
  pendingFaceArea: Area | null;
  cropMode: CropMode;
  contrast: number;
  brightness: number;
};
export type WorkProgress = {
  kind: "detect" | "process" | "zip";
  current: number;
  total: number;
  label: string;
  detail?: string;
} | null;
export type WorkPreview = FilePreview | null;
export type CropGeometry = {
  key: string | null;
  mediaSize: MediaSize | null;
  cropSize: Size | null;
};
export type FaceDetectionResult = {
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
export type FaceDetectionFrameMessage = {
  type?: string;
  requestId?: string;
  ok?: boolean;
  result?: FaceDetectionResult;
  error?: string;
};

export const PHOTO_SETTINGS_STORAGE_KEY = "photo-3x4:settings:v2";
export const PHOTO_ASPECT = PHOTO_DEFAULTS.width / PHOTO_DEFAULTS.height;
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

export function getPhotoSettingsStorageKey(userId: string) {
  return `${PHOTO_SETTINGS_STORAGE_KEY}:${userId}`;
}

export async function getErrorMessage(response: Response) {
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

export function getDownloadFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function appendSettings(formData: FormData, values: PhotoSettings) {
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

export function appendBatchCrops(
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

export function loadImage(url: string) {
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

export function downloadResult(result: ResultFile) {
  const link = document.createElement("a");
  link.href = result.url;
  link.download = result.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function getFileKey(file: File) {
  return file.name;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function detectFaceInFrame(file: File, timeoutMs: number) {
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

export function getEditorState(
  states: Record<string, EditorState>,
  key: string | null,
) {
  return key ? states[key] ?? DEFAULT_EDITOR_STATE : DEFAULT_EDITOR_STATE;
}

export function isSameFileName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function getPhotoFormErrorMessages(errors: Record<string, unknown>) {
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
