"use client";

import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_FILE_BYTES,
  MIN_FILES,
} from "@/lib/reajuste-salarial/limits";
import { parsePercentageBasisPoints } from "@/lib/reajuste-salarial/money";

export type GenerationState =
  | { status: "idle"; progress: 0 }
  | { status: "uploading"; progress: number }
  | { status: "processing"; progress: 100 }
  | { status: "success"; progress: 100; fileName: string }
  | { status: "error"; progress: 0; messages: string[] };

export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function competencyFromFileName(fileName: string) {
  return /^(0[1-9]|1[0-2])-\d{4}\.xlsx$/i.test(fileName.trim())
    ? fileName.replace(/\.xlsx$/i, "")
    : null;
}

export function mergeFiles(current: File[], incoming: File[]) {
  const merged = new Map(current.map((file) => [fileKey(file), file]));
  for (const file of incoming) merged.set(fileKey(file), file);
  return [...merged.values()].slice(0, MAX_FILES);
}

export function validateGeneration(files: File[], percentage: string) {
  const messages: string[] = [];
  if (files.length < MIN_FILES || files.length > MAX_FILES) {
    messages.push(`Selecione de ${MIN_FILES} a ${MAX_FILES} arquivos .xlsx.`);
  }
  if (files.some((file) => !file.name.toLowerCase().endsWith(".xlsx"))) {
    messages.push("Somente arquivos .xlsx são aceitos.");
  }
  const competencies = files.map((file) => competencyFromFileName(file.name));
  if (competencies.some((competency) => competency === null)) {
    messages.push("Cada arquivo deve seguir o nome MM-AAAA.xlsx.");
  }
  const validCompetencies = competencies.filter((item): item is string => Boolean(item));
  if (new Set(validCompetencies).size !== validCompetencies.length) {
    messages.push("Não repita a mesma competência.");
  }
  if (files.some((file) => file.size === 0 || file.size > MAX_FILE_BYTES)) {
    messages.push("Cada arquivo deve ter entre 1 byte e 10 MB.");
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
    messages.push("O conjunto de arquivos deve ter no máximo 20 MB.");
  }
  try {
    parsePercentageBasisPoints(percentage);
  } catch {
    messages.push("Informe um percentual entre 0,01 e 100,00, com até duas casas.");
  }
  return messages;
}

export function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
