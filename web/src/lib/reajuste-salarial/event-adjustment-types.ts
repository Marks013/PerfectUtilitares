import type { Competency } from "./types";

export type EventAdjustmentSettings = {
  bonusOldValueCents: string;
  bonusNewValueCents: string | null;
  sundayOldValueCents: string;
  sundayNewValueCents: string | null;
  historicOverrides: Array<{ competencyKey: string; bonusOldValueCents: string; sundayOldValueCents: string }>;
};
export type EventAdjustmentResult = {
  received: boolean;
  paidCents: string;
  quantity: number | null;
  targetCents: string | null;
  differenceCents: string;
  quantitySource: "reference" | "amount" | "none";
  issue: string | null;
  exclusionReason?: string | null;
};
type EventAdjustmentMonth = {
  competency: Competency;
  inPayroll: boolean;
  employmentStatus?: string | null;
  exclusionReason?: string | null;
  bonus565: EventAdjustmentResult;
  indemnity901: EventAdjustmentResult;
};
export type EventAdjustmentEmployee = {
  registration: string;
  employeeName: string;
  branchAlias: string;
  months: EventAdjustmentMonth[];
  bonusDifferenceCents: string;
  sundayDifferenceCents: string;
  totalDifferenceCents: string;
};
export type EventAdjustmentReport = {
  excludeAbsentLatest?: boolean;
  settings: EventAdjustmentSettings;
  competencies: Competency[];
  employees: EventAdjustmentEmployee[];
  employeeCount: number;
  branchCount: number;
  bonusTotalCents: string;
  sundayTotalCents: string;
  grandTotalCents: string;
  generatedAt: string;
  issueCount: number;
  suggestions: { bonusOldValueCents: string | null; sundayOldValueCents: string | null; bonusEvidence: string; sundayEvidence: string };
};
export type ParsedSalaryEvent = { paidCents: string; reference: string; sourceRow: number };
export type ParsedSalaryEventEmployee = {
  employmentStatus?: string | null;
  role?: string | null;
  registration: string;
  employeeName: string;
  branchAlias: string;
  events: { "565": ParsedSalaryEvent[]; "901": ParsedSalaryEvent[] };
};
export type ParsedSalaryEventFile = {
  competency: Competency;
  sourceFile: string;
  sourceSheet: string;
  company: string | null;
  rows: ParsedSalaryEventEmployee[];
};
