"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Area } from "react-easy-crop";
import type { PhotoSettings } from "@/lib/photos/schema";
import {
  appendSettings,
  appendBatchCrops,
  getErrorMessage,
  getDownloadFileName,
  getEditorState,
  getFileKey,
  downloadResult,
  type ResultFile,
} from "./photo-3x4-workspace-model";
import type { usePhotoSettings } from "./use-photo-settings";
import type { Dispatch, SetStateAction } from "react";
import type { WorkPreview, WorkProgress } from "./photo-3x4-workspace-model";
import type { usePhotoEditor } from "./use-photo-editor";

export function usePhotoProcessing({
  editor,
  form,
  setWorkPreview,
  setWorkProgress,
}: {
  editor: ReturnType<typeof usePhotoEditor>;
  form: ReturnType<typeof usePhotoSettings>;
  setWorkPreview: Dispatch<SetStateAction<WorkPreview>>;
  setWorkProgress: Dispatch<SetStateAction<WorkProgress>>;
}) {
  const { files, editorStates, hasFiles, getPreviewForFile } = editor;
  const [processingFileKey, setProcessingFileKey] = useState<string | null>(
    null,
  );
  const [singleResult, setSingleResult] = useState<ResultFile | null>(null);
  const [zipResult, setZipResult] = useState<ResultFile | null>(null);
  function clearResults() {
    setSingleResult(null);
    setZipResult(null);
  }

  async function processOne(
    file: File,
    values: PhotoSettings,
    cropArea?: Area | null,
  ) {
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

  return {
    clearResults,
    singlePhotoMutation,
    zipMutation,
    processZip,
    processPhotoFile,
    processingFileKey,
    singleResult,
    zipResult,
  };
}
