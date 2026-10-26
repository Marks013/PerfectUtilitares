/** Versioned, tenant-scoped inputs. All durations are integer minutes. */
export type WeeklyHours = 40 | 42 | 44;
export type EscalaAssignment = {
  employeeId: string;
  date: string;
  kind: "WORK" | "OFF" | "ABSENCE";
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
  shiftIds: string[];
  activeFrom: string;
  activeUntil?: string;
  offMode: "VARIABLE" | "MIXED" | "FIXED";
  /** Monday=0, Sunday=6. Approved fixed days are hard constraints. */
  fixedOffDays: number[];
  offPattern: "ANY" | "CONSECUTIVE" | "PREFER_CONSECUTIVE";
  maxConsecutiveSundays: 1 | 2;
  preferredOffDays: number[];
  historyKnown: boolean;
  /** Previous actual assignments covering the policy lookback, not inferred absences. */
  history: EscalaAssignment[];
};
type EscalaDemand = {
  id: string;
  date: string;
  sector: string;
  role?: string;
  start: number;
  end: number;
  minimum: number;
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
  severity: "ERROR" | "PENDING";
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
export type EscalaSuggestion = {
  id: string;
  employeeId: string;
  offDates: string[];
  assignments: EscalaAssignment[];
  changedEmployeeIds: string[];
  validation: EscalaValidation;
  status: "VALIDATED" | "REQUIRES_CHANGES";
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
