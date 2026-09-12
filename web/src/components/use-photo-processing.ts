"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operation.current += 1;
      request.current?.abort();
    },
    [],
  );

  function clearResults() {
    operation.current += 1;
    request.current?.abort();
    request.current = null;
    singlePhotoMutation.reset();
    zipMutation.reset();
    setProcessingFileKey(null);
    setSingleResult(null);
    setZipResult(null);
  }

  async function processOne(
    file: File,
    values: PhotoSettings,
    cropArea?: Area | null,
    signal?: AbortSignal,
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
      signal,
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

  async function processBatchZip(values: PhotoSettings, signal: AbortSignal) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });
    appendSettings(formData, values);
    appendBatchCrops(formData, files, editorStates);

    const response = await fetch("/api/fotos/lote", {
      method: "POST",
      body: formData,
      signal,
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
      operationId,
      signal,
    }: {
      file: File;
      values: PhotoSettings;
      operationId: number;
      signal: AbortSignal;
    }) => {
      if (operationId !== operation.current)
        throw new Error("Operação cancelada.");
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
        signal,
      );
    },
    onSuccess(result, { operationId }) {
      if (operationId !== operation.current) return;
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
    onError(_error, { operationId }) {
      if (operationId !== operation.current) return;
      setWorkProgress(null);
      setWorkPreview(null);
    },
    onSettled(_data, _error, { operationId }) {
      if (operationId !== operation.current) return;
      request.current = null;
      setProcessingFileKey(null);
    },
  });

  const zipMutation = useMutation({
    mutationFn: async ({
      values,
      operationId,
      signal,
    }: {
      values: PhotoSettings;
      operationId: number;
      signal: AbortSignal;
    }) => {
      if (operationId !== operation.current)
        throw new Error("Operação cancelada.");
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
      const zip = await processBatchZip(values, signal);

      return {
        blob: zip.blob,
        fileName: zip.fileName,
        label: zip.label,
      };
    },
    onSuccess(result, { operationId }) {
      if (operationId !== operation.current) return;
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
    onError(_error, { operationId }) {
      if (operationId !== operation.current) return;
      setWorkProgress(null);
      setWorkPreview(null);
    },
    onSettled(_data, _error, { operationId }) {
      if (operationId === operation.current) request.current = null;
    },
  });

  function processZip(
    event?: Parameters<ReturnType<typeof form.handleSubmit>>[0],
  ) {
    const submittedOperation = operation.current;
    return form.handleSubmit((values) => {
      if (submittedOperation !== operation.current) return;
      clearResults();
      request.current = new AbortController();
      zipMutation.mutate({
        values,
        operationId: operation.current,
        signal: request.current.signal,
      });
    })(event);
  }

  function processPhotoFile(file: File | null) {
    if (!file || singlePhotoMutation.isPending) {
      return;
    }

    const submittedOperation = operation.current;
    void form.handleSubmit((values) => {
      if (submittedOperation !== operation.current) return;
      clearResults();
      request.current = new AbortController();
      setProcessingFileKey(getFileKey(file));
      singlePhotoMutation.mutate({
        file,
        values,
        operationId: operation.current,
        signal: request.current.signal,
      });
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
