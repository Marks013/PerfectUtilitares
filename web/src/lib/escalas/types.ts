/** Versioned, tenant-scoped inputs. All durations are integer minutes. */
export type WeeklyHours = 40 | 42 | 44;
type SundayRestRule = "PROTECTIVE" | "UNREVIEWED" | "CLT_386" | "COMMERCE";
export type EscalaAssignment = {
  employeeId: string;
  date: string;
  kind: "WORK" | "DUTY" | "OFF" | "ABSENCE";
  shiftId?: string;
  locked?: boolean;
};
export type EscalaShift = {
  id: string;
  name: string;
  /** Offsets from midnight of the journey's reference date; end may exceed 1440. */
  segments: { start: number; end: number; kind: "WORK" | "PAID_BREAK" | "BREAK" }[];
};
export type EscalaEmployee = {
  id: string;
  registration: string;
  name: string;
  sector: string;
  role: string;
  weeklyHours: WeeklyHours;
  /** FPRE136 has no contract-hours field; a branch reference remains adjustable until individually overridden. */
  weeklyHoursMode?: "BRANCH" | "INDIVIDUAL";
  shiftIds: string[];
  /** Empty means employment dates are unknown; it never represents a new admission. */
  activeFrom: string;
  activeUntil?: string;
  planningEnabled?: boolean;
  /** DUTY assigns a workday without inventing a clock schedule or credited hours. */
  scheduleMode?: "TIMED" | "MISSING" | "UNTIMED";
  planningExclusionReason?: string;
  sourceSchedule?: { report: "FPRE136"; code: string; description: string; weekday: string; saturday: string };
  offMode: "VARIABLE" | "MIXED" | "FIXED";
  /** Monday=0, Sunday=6. Approved fixed days are hard constraints. */
  fixedOffDays: number[];
  offPattern: "ANY" | "CONSECUTIVE" | "PREFER_CONSECUTIVE";
  maxConsecutiveSundays: 1 | 2;
  /** Explicit legal classification, never inferred from names or the numeric cap. */
  sundayRestRule?: SundayRestRule;
  preferredOffDays: number[];
  historyKnown: boolean;
  /** Previous actual assignments covering the policy lookback, not inferred absences. */
  history: EscalaAssignment[];
  /** Prior published schedules, kept separate from actual attendance history. */
  planningHistory?: EscalaAssignment[];
  /** Trusted following published days; context only, never monthly assignments or actual attendance. */
  planningFuture?: EscalaAssignment[];
};
type EscalaDemand = {
  id: string;
  date: string;
  sector: string;
  role?: string;
  start: number;
  end: number;
  minimum: number;
  /** Automatic estimates stay provisional until an explicit branch-wide coverage review. */
  estimated?: boolean;
};
export type EscalaPolicy = {
  source: string;
  validFrom: string;
  validUntil: string;
  reviewed: boolean;
  reviewedBy: string;
  weeklyLimit: WeeklyHours;
  dailyLimitMinutes: number;
  compensationAuthorized: boolean;
  normativeProfile?: "CUSTOM" | "SINDECOMU_SUPERMARKETS_2026_2027";
  transitionWeekAccepted?: boolean;
  coverageReview?: "SUGGESTED" | "CONFIRMED";
  collectiveAgreement?: {
    source: string; validFrom: string; validUntil: string; reviewedBy: string; reviewed: boolean;
  };
  operationalCertificate?: {
    identifier: string; validFrom: string; validUntil: string; reviewedBy: string; reviewed: boolean;
    sundays: boolean; holidays: boolean; after20: boolean;
  };
  minInterShiftMinutes: number;
  minWeeklyRestMinutes: number;
  minMealMinutes: number;
  maxConsecutiveWorkDays: number;
  /** Dates that may not be worked, and holiday work expressly authorized by the policy. */
  closedDates: string[];
  holidayDates: string[];
  authorizedHolidayDates: string[];
  holidayRestAllowed: boolean;
  nightWorkReviewed: boolean;
};
export type EscalaInput = {
  schemaVersion: 1;
  branchCode: string;
  branchName: string;
  startDate: string;
  endDate: string;
  /** Civil month shown to users. Technical dates retain full weeks for continuity. */
  visibleMonth?: string;
  defaultWeeklyHours: WeeklyHours;
  timeZone: "America/Sao_Paulo";
  policy: EscalaPolicy;
  employees: EscalaEmployee[];
  shifts: EscalaShift[];
  demands: EscalaDemand[];
  assignments: EscalaAssignment[];
};
export type EscalaIssue = {
  code: string;
  message: string;
  severity: "ERROR" | "PENDING" | "WARNING";
  employeeId?: string;
  date?: string;
};
export type EscalaEmployeeSummary = {
  employeeId: string;
  workedMinutes: number;
  workDays: number;
  offDays: number;
  maxStreak: number;
  sundaysWorked: number;
};
export type EscalaValidation = {
  valid: boolean;
  readyToPublish: boolean;
  issues: EscalaIssue[];
  summaries: EscalaEmployeeSummary[];
  minimumCoverageMargin: number | null;
  /** Fixed day off just beyond the horizon needed to preserve a consecutive pair. */
  boundaryReservations?: EscalaAssignment[];
};
export type EscalaSolveResult = {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "MODEL_INVALID";
  assignments: EscalaAssignment[];
  message: string;
  wallTimeSeconds: number;
};
export type EscalaGenerationPreparation = {
  adjustedEmployeeIds: string[];
  excludedEmployeeIds: string[];
  generatedCoverageSlots: number;
  includedEmployees: number;
  untimedEmployees: number;
};
export type EscalaWorkspace = {
  id: string;
  revision: number;
  status: "DRAFT" | "PUBLISHED";
  input: EscalaInput;
  validation: EscalaValidation;
  canEdit: boolean;
  canPublish: boolean;
  updatedAt: string;
};
