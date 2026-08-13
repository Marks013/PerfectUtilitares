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
import {
  type ResultFile,
  type FilePreview,
  type EditorState,
  type WorkProgress,
  type WorkPreview,
  type CropGeometry,
  PHOTO_SETTINGS_STORAGE_KEY,
  PHOTO_ASPECT,
  getPhotoSettingsStorageKey,
  getErrorMessage,
  getDownloadFileName,
  appendSettings,
  appendBatchCrops,
  loadImage,
  downloadResult,
  getFileKey,
  detectFaceInFrame,
  getEditorState,
  isSameFileName,
  getPhotoFormErrorMessages
} from "./photo-3x4-workspace-model";
export * from "./photo-3x4-workspace-model";
import { Photo3x4WorkspaceView } from "./photo-3x4-workspace-view";

export function usePhoto3x4WorkspaceController({ userId }: { userId: string }) {
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
  const [processingFileKey, setProcessingFileKey] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<ResultFile | null>(null);
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
      nextPreviews.forEach((preview) => {
        URL.revokeObjectURL(preview.url);
      });
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

    setEditorStates((current) => ({
      ...current,
      [selectedKey]: {
        ...getEditorState(current, selectedKey),
        crop: initialCrop.crop,
        zoom: initialCrop.zoom,
        croppedArea: selectedEditor.pendingFaceArea,
        pendingFaceArea: null,
      },
    }));
  }, [
    cropGeometry,
    selectedEditor.cropMode,
    selectedEditor.pendingFaceArea,
    selectedKey,
  ]);

  function clearResults() {
    setSingleResult(null);
    setZipResult(null);
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
      blob,
      fileName: getDownloadFileName(response, "foto-3x4.jpg"),
      label: file.name,
    };
  }

  async function processBatchZip(values: PhotoSettings) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });
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

  const singlePhotoMutation = useMutation({
    mutationFn: async ({
      file,
      values,
    }: {
      file: File;
      values: PhotoSettings;
    }) => {
      setWorkPreview(getPreviewForFile(file));
      setWorkProgress({
        kind: "process",
        current: 1,
        total: 1,
        label: "Processando foto",
        detail: file.name,
      });
      const state = getEditorState(editorStates, getFileKey(file));
      return processOne(
        file,
        {
          ...values,
          contrast: state.contrast,
          brightness: state.brightness,
        },
        state.croppedArea,
      );
    },
    onSuccess(result) {
      setWorkPreview(null);
      setWorkProgress({
        kind: "process",
        current: 1,
        total: 1,
        label: "Foto concluída",
        detail: result.fileName,
      });
      setSingleResult(result);
      downloadResult(result);
    },
    onError() {
      setWorkProgress(null);
      setWorkPreview(null);
    },
    onSettled() {
      setProcessingFileKey(null);
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
        blob: zip.blob,
        fileName: zip.fileName,
        label: zip.label,
      };
    },
    onSuccess(result) {
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

  const processZip = form.handleSubmit((values) => {
    clearResults();
    zipMutation.mutate(values);
  });

  function processPhotoFile(file: File | null) {
    if (!file || singlePhotoMutation.isPending) {
      return;
    }

    void form.handleSubmit((values) => {
      clearResults();
      setProcessingFileKey(getFileKey(file));
      singlePhotoMutation.mutate({ file, values });
    })();
  }

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
    singlePhotoMutation.isPending ||
    zipMutation.isPending ||
    isDetectingFace ||
    isDetectingBatchFaces;

    return { Archive, ChevronLeft, ChevronRight, Cropper, Download, ImageIcon, Loader2, PHOTO_ASPECT, PHOTO_DEFAULTS, RotateCcw, ScanFace, Scissors, SlidersHorizontal, Upload, X, clearFiles, cropAreaBorderWidth, cropModeDescription, detectFace, detectFacesInBatch, downloadResult, editorStates, faceStatus, files, form, getEditorState, getFileKey, getPhotoFormErrorMessages, goToPhoto, hasFiles, isBatch, isBusy, isDetectingBatchFaces, isDetectingFace, previewBorderColor, previewBorderWidth, previewFilter, previewUrl, processPhotoFile, processZip, processingFileKey, progressPercent, resetAdjustments, selectedEditor, selectedFile, selectedIndex, selectedKey, setCropGeometry, setSelectedEditorState, setSelectedIndex, singlePhotoMutation, singleResult, updateFiles, watchedAddBorder, watchedBorderColor, watchedQuality, workPreview, workProgress, zipMutation, zipResult };
}

export function Photo3x4Workspace(props: Parameters<typeof usePhoto3x4WorkspaceController>[0]) {
  return <Photo3x4WorkspaceView model={usePhoto3x4WorkspaceController(props)} />;
}
