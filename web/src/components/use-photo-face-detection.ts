"use client";

import { useState } from "react";
import type { Area } from "react-easy-crop";
import { getPendingFaceCropInitialization } from "@/lib/photos/editor-crop";
import { createFaceCropArea } from "@/lib/photos/face-crop";
import {
  detectFaceInFrame,
  loadImage,
  PHOTO_ASPECT,
  getEditorState,
  getFileKey,
  type EditorState,
} from "./photo-3x4-workspace-model";
import type { Dispatch, SetStateAction } from "react";
import type { WorkPreview, WorkProgress } from "./photo-3x4-workspace-model";
import type { usePhotoEditor } from "./use-photo-editor";

export function usePhotoFaceDetection({
  editor,
  clearResults,
  setWorkPreview,
  setWorkProgress,
}: {
  editor: ReturnType<typeof usePhotoEditor>;
  clearResults: () => void;
  setWorkPreview: Dispatch<SetStateAction<WorkPreview>>;
  setWorkProgress: Dispatch<SetStateAction<WorkProgress>>;
}) {
  const {
    files,
    editorStates,
    cropGeometry,
    previewUrl,
    selectedFile,
    selectedKey,
    selectedPreview,
    hasFiles,
    setFaceStatus,
    setEditorStates,
    setEditorStateForKey,
    getPreviewForFile,
  } = editor;
  const [isDetectingFace, setIsDetectingFace] = useState(false);
  const [isDetectingBatchFaces, setIsDetectingBatchFaces] = useState(false);
  function waitForPaint() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async function createFaceDetectionCrop(
    file: File,
    previewUrlForFile?: string,
  ) {
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

  function createDetectedEditorState(
    key: string,
    area: Area,
  ): Partial<EditorState> {
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
      setFaceStatus(
        "Selecione uma foto primeiro para usar a detecção de rosto.",
      );
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
      setEditorStateForKey(
        detectionKey,
        createDetectedEditorState(detectionKey, area),
      );
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

  return {
    detectFace,
    detectFacesInBatch,
    isDetectingFace,
    isDetectingBatchFaces,
    setIsDetectingFace,
    setIsDetectingBatchFaces,
  };
}
