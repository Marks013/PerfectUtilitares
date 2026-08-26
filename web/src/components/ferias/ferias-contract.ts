import { z } from "zod";
import type { FeriasAnalysis, FeriasChoice as ServerFeriasChoice, FeriasResultRow } from "@/lib/ferias/contracts";

export type { FeriasAnalysis } from "@/lib/ferias/contracts";
export type FeriasRow = FeriasResultRow;
export type FeriasChoice = ServerFeriasChoice;

const candidateSchema = z.object({ id: z.string(), label: z.string() });
const rowSchema = z.object({
  row: z.number().int(),
  registration: z.string(),
  branch: z.string(),
  name: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.number(),
  highlight: z.boolean(),
  unimedText: z.string(),
  loanText: z.string(),
  issues: z.array(z.string()),
  warnings: z.array(z.string()),
  holderId: z.string().optional(),
  loanIdentity: z.string().optional(),
  holderCandidates: z.array(candidateSchema),
  loanCandidates: z.array(candidateSchema),
});

export const analysisSchema: z.ZodType<FeriasAnalysis> = z.object({
  competency: z.string().regex(/^\d{4}-\d{2}$/),
  revision: z.string().min(1),
  sources: z.array(z.object({
    name: z.string(), ready: z.boolean(),
    competency: z.string().regex(/^\d{4}-\d{2}$/), fallback: z.boolean(),
  })),
  pricePeriods: z.array(z.string()),
  issues: z.array(z.string()),
  rows: z.array(rowSchema).max(1000),
  summary: z.object({
    total: z.number(), unimed: z.number(), loans: z.number(),
    pending: z.number(), highlighted: z.number(),
  }),
  canExport: z.boolean(),
});

export function formatCompetency(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? `${value.slice(5)}/${value.slice(0, 4)}` : value;
}

export function formatVacationDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(8)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : value;
}

export function validateVacationFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) return "Escolha uma planilha no formato XLSX.";
  if (!file.size) return "A planilha está vazia. Selecione o arquivo novamente.";
  if (file.size > 5 * 1024 * 1024) return "A planilha deve ter até 5 MB.";
  return null;
}

export async function readResponseError(response: Response) {
  const fallback = response.status === 409
    ? "As bases foram atualizadas. Analise a planilha novamente antes de baixar."
    : response.status === 401 || response.status === 403
      ? "Seu acesso expirou ou não permite esta operação. Entre novamente com uma conta administrativa."
      : response.status === 413
        ? "O arquivo ou uma das bases excede o limite seguro desta conferência. Reduza o arquivo ou peça ao administrador para revisar a base."
        : response.status === 422
          ? "A planilha precisa de ajustes antes da conferência. Revise as linhas indicadas e envie novamente."
          : response.status === 429
            ? "Já existe uma conferência em andamento. Aguarde um instante e tente novamente."
            : response.status === 503
              ? "A conferência está temporariamente indisponível. Aguarde alguns instantes e tente novamente."
              : "Não foi possível concluir. Tente novamente em instantes.";
  const body: unknown = await response.json().catch(() => null);
  const parsed = z.object({ error: z.object({ message: z.string().min(1) }) }).safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}

export function operationErrorMessage(error: unknown, operation: "analisar" | "exportar") {
  const code = error instanceof Error ? error.message : "";
  if (code === "invalid-response") {
    return "O servidor respondeu em um formato inesperado. Atualize a página e analise a planilha novamente.";
  }
  if (code === "invalid-download") {
    return "O arquivo retornado não é uma planilha válida. Analise novamente antes de baixar.";
  }
  if (code === "empty-download") {
    return "A planilha conferida veio vazia. Analise novamente e tente o download mais uma vez.";
  }
  return operation === "analisar"
    ? "Não foi possível analisar a planilha. Confira sua conexão e tente novamente."
    : "Não foi possível gerar a planilha conferida. Sua análise foi preservada; tente baixar novamente.";
}
