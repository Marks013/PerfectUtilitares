import { z } from "zod";
import type { FeriasInputRow } from "./workbook";

export const choicesSchema = z.array(z.object({
  row: z.number().int().min(4).max(2000),
  holderId: z.string().min(1).max(100).optional(),
  loanIdentity: z.string().min(1).max(100).optional(),
}).strict()).max(1000).refine(
  (choices) => new Set(choices.map((choice) => choice.row)).size === choices.length,
  "Há confirmações repetidas para a mesma linha.",
);
export type FeriasChoice = z.infer<typeof choicesSchema>[number];
export type FeriasCandidate = { id: string; label: string };
type FeriasSource = {
  name: string;
  ready: boolean;
  competency: string;
  fallback: boolean;
};
export type FeriasResultRow = FeriasInputRow & {
  unimedText: string;
  loanText: string;
  issues: string[];
  warnings: string[];
  holderId?: string;
  loanIdentity?: string;
  holderCandidates: FeriasCandidate[];
  loanCandidates: FeriasCandidate[];
};
export type FeriasAnalysis = {
  competency: string;
  revision: string;
  sources: FeriasSource[];
  pricePeriods: string[];
  issues: string[];
  rows: FeriasResultRow[];
  summary: { total: number; unimed: number; loans: number; pending: number; highlighted: number };
  canExport: boolean;
};

export type FeriasBeneficiary = {
  id: string; holderId: string | null; registration: string | null;
  fullName: string; cpf: string | null; branchId: string | null;
  branchLabel?: string;
  category: string; birthDate: string | null; planCode: string | null;
};
export type FeriasInvoice = {
  id: string; beneficiaryId: string | null; branchId: string | null;
  beneficiaryName: string; holderName: string | null; category: string;
  itemDescription: string; amount: string;
};
export type FeriasLoan = {
  id: string; beneficiaryId: string | null; registration: string | null;
  employeeName: string; cpfNormalized: string | null; contractNumber: string;
  installmentAmount: string; competence: string; startCompetence: string;
  endCompetence: string; bankCode: string; companyCnpj: string | null;
};
export type FeriasPrice = {
  id: string; planCode: string; employeeAmount: string; companyAmount: string;
  validFrom: string; validTo: string | null;
  ageBracket: { code: string; minAge: number; maxAge: number | null };
};
export type FeriasSnapshot = {
  revision: string;
  sources: FeriasSource[];
  beneficiaries: FeriasBeneficiary[];
  invoices: FeriasInvoice[];
  loans: FeriasLoan[];
  prices: FeriasPrice[];
};
