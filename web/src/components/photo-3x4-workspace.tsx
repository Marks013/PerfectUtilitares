"use client";

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
import { useEffect, useEffectEvent, useState } from "react";
import Cropper from "react-easy-crop";
import { PHOTO_DEFAULTS } from "@/lib/photos/schema";
import {
  PHOTO_ASPECT,
  downloadResult,
  getEditorState,
  getFileKey,
  getPhotoFormErrorMessages,
  type WorkProgress,
  type WorkPreview,
} from "./photo-3x4-workspace-model";
import { Photo3x4WorkspaceView } from "./photo-3x4-workspace-view";
import { usePhotoSettings } from "./use-photo-settings";
import { usePhotoEditor } from "./use-photo-editor";
import { usePhotoProcessing } from "./use-photo-processing";
import { usePhotoFaceDetection } from "./use-photo-face-detection";
export * from "./photo-3x4-workspace-model";

export function usePhoto3x4WorkspaceController({ userId }: { userId: string }) {
  const form = usePhotoSettings(userId);
  const [workProgress, setWorkProgress] = useState<WorkProgress>(null);
  const [workPreview, setWorkPreview] = useState<WorkPreview>(null);
  const editor = usePhotoEditor(resetWork);
  const {
    files,
    editorStates,
    faceStatus,
    hasFiles,
    isBatch,
    previewUrl,
    selectedEditor,
    selectedFile,
    selectedIndex,
    selectedKey,
    setCropGeometry,
    setFaceStatus,
    setEditorStates,
    setSelectedEditorState,
    setSelectedIndex,
    updateFiles,
    clearFiles,
    goToPhoto,
  } = editor;
  const processing = usePhotoProcessing({
    editor,
    form,
    setWorkPreview,
    setWorkProgress,
  });
  const {
    clearResults,
    singlePhotoMutation,
    zipMutation,
    processZip,
    processPhotoFile,
    processingFileKey,
    singleResult,
    zipResult,
  } = processing;
  const {
    detectFace,
    detectFacesInBatch,
    isDetectingFace,
    isDetectingBatchFaces,
    cancelDetection,
  } = usePhotoFaceDetection({
    editor,
    clearResults,
    setWorkPreview,
    setWorkProgress,
  });

  function resetWork() {
    processing.clearResults();
    cancelDetection();
    setFaceStatus(null);
    setWorkProgress(null);
    setWorkPreview(null);
  }

  const onSettingsChange = useEffectEvent(resetWork);
  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (name) onSettingsChange();
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const visibleEditor = workPreview
    ? getEditorState(editorStates, workPreview.key)
    : selectedEditor;
  const watchedQuality = form.watch("quality");
  const watchedAddBorder = form.watch("addBorder");
  const watchedBorderWidth = form.watch("borderWidth");
  const watchedBorderColor = form.watch("borderColor");
  const previewFilter = `brightness(${Number(visibleEditor.brightness || PHOTO_DEFAULTS.brightness)}) contrast(${Number(visibleEditor.contrast || PHOTO_DEFAULTS.contrast)})`;
  const previewBorderWidth = watchedAddBorder
    ? Math.max(1, Number(watchedBorderWidth || PHOTO_DEFAULTS.borderWidth))
    : 0;
  const previewBorderColor =
    watchedBorderColor === "white" ? "#ffffff" : "#111827";
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

  function resetAdjustments() {
    resetWork();
    setFaceStatus(null);
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

  const isBusy =
    singlePhotoMutation.isPending ||
    zipMutation.isPending ||
    isDetectingFace ||
    isDetectingBatchFaces;

  return {
    Archive,
    ChevronLeft,
    ChevronRight,
    Cropper,
    Download,
    ImageIcon,
    Loader2,
    PHOTO_ASPECT,
    PHOTO_DEFAULTS,
    RotateCcw,
    ScanFace,
    Scissors,
    SlidersHorizontal,
    Upload,
    X,
    clearFiles,
    cropAreaBorderWidth,
    cropModeDescription,
    detectFace,
    detectFacesInBatch,
    downloadResult,
    editorStates,
    faceStatus,
    files,
    form,
    getEditorState,
    getFileKey,
    getPhotoFormErrorMessages,
    goToPhoto,
    hasFiles,
    isBatch,
    isBusy,
    isDetectingBatchFaces,
    isDetectingFace,
    previewBorderColor,
    previewBorderWidth,
    previewFilter,
    previewUrl,
    processPhotoFile,
    processZip,
    processingFileKey,
    progressPercent,
    resetAdjustments,
    selectedEditor,
    selectedFile,
    selectedIndex,
    selectedKey,
    setCropGeometry,
    setSelectedEditorState,
    setSelectedIndex,
    singlePhotoMutation,
    singleResult,
    updateFiles,
    watchedAddBorder,
    watchedBorderColor,
    watchedQuality,
    workPreview,
    workProgress,
    zipMutation,
    zipResult,
  };
}

export function Photo3x4Workspace(
  props: Parameters<typeof usePhoto3x4WorkspaceController>[0],
) {
  return (
    <Photo3x4WorkspaceView model={usePhoto3x4WorkspaceController(props)} />
  );
}
