import type {
  UnimedCalculationInput,
  UnimedCalculationResult,
} from "@/lib/unimed/types";
import type { UnimedPayrollLoanSummary } from "./unimed-print-summary";

export type MoneyField = "invoicePlanAmount" | "payrollPlanAmount" | "addonAmount";

type MoneyValues = Record<MoneyField, string>;

export type DependentValues = {
  id: string;
  name: string;
  birthDate: string | null;
  planCode: string | null;
  age: number | null;
  hasAddon: boolean;
  invoicePlanAmount: string;
  addonAmount: string;
};

export type FormValues = {
  employeeName: string;
  cpf: string;
  reasonCode: string;
  exclusionDate: string;
  planEnrollmentDate: string;
  billingClosure: UnimedCalculationInput["billingClosure"];
  holder: MoneyValues;
  dependents: DependentValues[];
};

export type FieldErrors = Partial<
  Record<
    | "employeeName"
    | "cpf"
    | "reasonCode"
    | "exclusionDate"
    | "planEnrollmentDate"
    | MoneyField
    | `dependent-${string}`,
    string
  >
>;

export type ApiErrorBody = {
  error?: string | { message?: string };
  details?: Array<{ message?: string }>;
};

export type GeneratedDocument = {
  beneficiaryId: string;
  previewUrl: string;
  reasonCode: number;
};

export type DocumentJobResponse = {
  job: {
    id: string;
    progress: number;
    status: "QUEUED" | "RUNNING";
  };
};

export type UnimedCalculationRequest = {
  beneficiaryId: string;
  dependentIds: string[];
  reasonCode: number;
  exclusionDate: string;
};

export type UnimedCalculationApiResponse = {
  calculation: UnimedCalculationResult;
  officialInput: UnimedCalculationInput;
  payrollLoans?: UnimedPayrollLoanSummary | null;
};

export type UnimedExclusionReasonOption = {
  code: number;
  label: string;
  documentKind: "NONE" | "RN561" | "INACTIVE_TERM";
};
