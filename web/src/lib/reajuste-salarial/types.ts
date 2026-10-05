export type SalaryAdvancePdfKind = "summary" | "detailed";
export type SalaryAdvanceScope = "standard" | "drivers-forklift";
export type SalaryAdvanceScopeOptions = {
  salaryScope: SalaryAdvanceScope;
  excludeAbsentLatest?: boolean;
  driverPercentageTenThousandths?: bigint;
  percentageHundredThousandths?: bigint;
  packerPercentageHundredThousandths?: bigint;
  driverPercentageHundredThousandths?: bigint;
};

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
  employmentStatus?: string | null;
  role?: string | null;
};

type AdvanceCompetencyRule = {
  employmentStatus: string | null;
  role: string | null;
  percentageTenThousandths: bigint;
  percentageHundredThousandths?: bigint;
  exclusionReason: string | null;
  metadataKnown: boolean;
  scopeEligible?: boolean;
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
  advanceRulesByCompetency?: Map<string, AdvanceCompetencyRule>;
};

export type BranchReportGroup = {
  branchAlias: string;
  employees: ConsolidatedEmployee[];
  employeeCount: number;
  subtotalCents: bigint;
};

export type SalaryAdvanceReport = {
  excludeAbsentLatest?: boolean;
  parserProfile: "antecipacao-inss-v1";
  generatedAt: Date;
  percentageBasisPoints: bigint;
  packerPercentageTenThousandths?: bigint;
  salaryScope?: SalaryAdvanceScope;
  driverPercentageTenThousandths?: bigint;
  percentageHundredThousandths?: bigint;
  packerPercentageHundredThousandths?: bigint;
  driverPercentageHundredThousandths?: bigint;
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
