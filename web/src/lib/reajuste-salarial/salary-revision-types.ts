export type ParsedSalaryRevisionEmployee = {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  branchAlias: string;
  registration: string;
  employeeName: string;
  role: string;
  currentSalaryCents: bigint;
};

export type ParsedSalaryRevisionFile = {
  sourceFile: string;
  sourceSheet: string;
  employees: ParsedSalaryRevisionEmployee[];
};

export type SalaryRevisionRule = {
  id: string;
  name: string;
  minimumSalaryCents: bigint;
  maximumSalaryCents: bigint;
  newSalaryCents: bigint;
  selectedRegistrations: string[];
};

export type AppliedSalaryRevisionEmployee = ParsedSalaryRevisionEmployee & {
  application:
    | { kind: "general" }
    | { kind: "special"; ruleId: string; ruleName: string };
  adjustmentCents: bigint;
  newSalaryCents: bigint;
};

export type SalaryRevisionBranchGroup = {
  branchAlias: string;
  employees: AppliedSalaryRevisionEmployee[];
  employeeCount: number;
  currentPayrollCents: bigint;
  adjustmentSubtotalCents: bigint;
  newPayrollCents: bigint;
};

export type SalaryRevisionReport = {
  parserProfile: "fpre131-reajuste-v1";
  sourceFile: string;
  generatedAt: Date;
  generalPercentageBasisPoints: bigint;
  rules: SalaryRevisionRule[];
  groups: SalaryRevisionBranchGroup[];
  employeeCount: number;
  generalEmployeeCount: number;
  specialEmployeeCount: number;
  currentPayrollCents: bigint;
  totalAdjustmentCents: bigint;
  newPayrollCents: bigint;
};

export type SalaryRevisionAnalysisEmployee = {
  branchAlias: string;
  registration: string;
  employeeName: string;
  role: string;
  currentSalaryCents: string;
};

export type SalaryRevisionAnalysis = {
  fileHash: string;
  sourceFile: string;
  employeeCount: number;
  branchCount: number;
  distinctSalaryCount: number;
  minimumSalaryCents: string;
  maximumSalaryCents: string;
  employees: SalaryRevisionAnalysisEmployee[];
  salaries: Array<{ salaryCents: string; employeeCount: number }>;
};
