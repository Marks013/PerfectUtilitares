"use client";

import { useEffect, useState } from "react";
import { getPendingFaceCropInitialization } from "@/lib/photos/editor-crop";
import {
  getEditorState,
  getFileKey,
  isSameFileName,
  type FilePreview,
  type EditorState,
  type CropGeometry,
} from "./photo-3x4-workspace-model";

function hasEditorChange(current: EditorState, next: Partial<EditorState>) {
  const samePoint = (left: EditorState["crop"], right: EditorState["crop"]) =>
    Math.abs(left.x - right.x) < 0.000001 &&
    Math.abs(left.y - right.y) < 0.000001;
  const sameArea = (
    left: EditorState["croppedArea"],
    right: EditorState["croppedArea"],
  ) =>
    left === right ||
    (left !== null &&
      right !== null &&
      samePoint(left, right) &&
      left.width === right.width &&
      left.height === right.height);
  return (
    (next.crop !== undefined && !samePoint(current.crop, next.crop)) ||
    (next.croppedArea !== undefined &&
      !sameArea(current.croppedArea, next.croppedArea)) ||
    (next.pendingFaceArea !== undefined &&
      !sameArea(current.pendingFaceArea, next.pendingFaceArea)) ||
    (next.zoom !== undefined &&
      Math.abs(current.zoom - next.zoom) >= 0.000001) ||
    (next.cropMode !== undefined && current.cropMode !== next.cropMode) ||
    (next.contrast !== undefined && current.contrast !== next.contrast) ||
    (next.brightness !== undefined && current.brightness !== next.brightness)
  );
}

export function usePhotoEditor(resetWork: () => void) {
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editorStates, setEditorStates] = useState<Record<string, EditorState>>(
    {},
  );
  const [cropGeometry, setCropGeometry] = useState<CropGeometry>({
    key: null,
    mediaSize: null,
    cropSize: null,
  });
  const [faceStatus, setFaceStatus] = useState<string | null>(null);
  const selectedFile = files[selectedIndex] ?? files[0] ?? null;
  const selectedKey = selectedFile ? getFileKey(selectedFile) : null;
  const selectedPreview = selectedKey
    ? filePreviews.find((preview) => preview.key === selectedKey)
    : null;
  const previewUrl = selectedPreview?.url ?? null;
  const selectedEditor = getEditorState(editorStates, selectedKey);
  const hasFiles = files.length > 0;
  const isBatch = files.length > 1;

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

  function updateFiles(nextFiles: File[]) {
    resetWork();
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
      setSelectedIndex(
        nextIndex >= 0 ? nextIndex : Math.max(0, merged.length - 1),
      );
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
    resetWork();
    setFiles([]);
    setEditorStates({});
    setSelectedIndex(0);
    setCropGeometry({ key: null, mediaSize: null, cropSize: null });
  }

  function setSelectedEditorState(nextState: Partial<EditorState>) {
    // Cropper emits the same geometry when the processing preview is unmounted.
    // Only a real edit should invalidate a completed download.
    if (!selectedKey || !hasEditorChange(selectedEditor, nextState)) {
      return;
    }

    resetWork();
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

  return {
    files,
    filePreviews,
    selectedIndex,
    selectedFile,
    selectedKey,
    selectedPreview,
    previewUrl,
    selectedEditor,
    editorStates,
    cropGeometry,
    faceStatus,
    hasFiles,
    isBatch,
    setEditorStates,
    setCropGeometry,
    setFaceStatus,
    setSelectedIndex,
    updateFiles,
    clearFiles,
    setSelectedEditorState,
    getPreviewForFile,
    setEditorStateForKey,
    goToPhoto,
  };
}
