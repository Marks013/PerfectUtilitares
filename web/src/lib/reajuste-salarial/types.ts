export type Competency = {
  key: `${string}-${string}`;
  month: number;
  year: number;
  order: number;
};

export type ParsedPayrollRow = {
  competency: Competency;
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  branchAlias: string;
  registration: string;
  employeeName: string;
  baseCents: bigint;
};

export type ParsedPayrollFile = {
  competency: Competency;
  sourceFile: string;
  sourceSheet: string;
  rows: ParsedPayrollRow[];
};

export type ConsolidatedEmployee = {
  registration: string;
  employeeName: string;
  branchAlias: string;
  basesByCompetency: Map<string, bigint | null>;
  adjustmentsByCompetency: Map<string, bigint>;
  totalAdjustmentCents: bigint;
};

export type BranchReportGroup = {
  branchAlias: string;
  employees: ConsolidatedEmployee[];
  employeeCount: number;
  subtotalCents: bigint;
};

export type AdjustmentReport = {
  parserProfile: "folha-inss-v1";
  generatedAt: Date;
  percentageBasisPoints: bigint;
  competencies: Competency[];
  groups: BranchReportGroup[];
  employeeCount: number;
  grandTotalCents: bigint;
};

export type SalaryAdjustmentDiagnostic = {
  file?: string;
  sheet?: string;
  row?: number;
  message: string;
};
