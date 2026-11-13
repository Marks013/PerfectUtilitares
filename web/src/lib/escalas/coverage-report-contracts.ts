import type { CoverageAnalysis, CoverageAnalysisOptions } from "./coverage-analysis";

/** Shared projection contracts. All hours describe the saved/planned roster, not clocked attendance. */
export type CoverageReportOptions = Omit<CoverageAnalysisOptions, "details"> & {
  context?: { revision?: number; runtime?: string; kind?: "SAVED" | "PROPOSAL" };
};

export type OperationalCounts = {
  /** Assignment categories are disjoint for active people; excluded people remain separate. */
  workTimed: number; workWithoutClock: number; duty: number; off: number; absence: number; holiday: number;
  excluded: number; unassigned: number;
  /** Subset of workWithoutClock with a malformed/missing TIMED shift; not intentional DUTY/UNTIMED. */
  unknownClock: number;
  /** Civil-window facts, not additional assignment categories; never sum them with the categories above. */
  presentTimed: number; pause: number; workOutsideWindow: number;
};

export type OperationalWindow = {
  date: string; sector: string; start: number; end: number; durationMinutes: number;
  counts: OperationalCounts;
  knownWorkPersonMinutes: number; knownCreditedPersonMinutes: number;
  roles: { role: string; presentTimed: number }[];
};

export type OperationalDay = {
  date: string; sector: string; status: "KNOWN" | "PARTIAL";
  counts: OperationalCounts;
  knownWorkPersonMinutes: number;
  workPersonMinutes: number | null; creditedPersonMinutes: number | null;
  /** Canonical assigned shifts; overlapping shift groups are not additive staffing requirements. */
  shiftGroups: { shiftId: string; label: string; people: number; knownWorkPersonMinutes: number; knownCreditedPersonMinutes: number }[];
  windows?: OperationalWindow[];
};

export type OperationalAnalysisOptions = {
  dates?: readonly string[];
  details?: boolean;
};
export type OperationalAnalysis = {
  status: "READY" | "PARTIAL" | "UNAVAILABLE";
  branchCode: string; visibleMonth: string | null; dates: string[]; omittedDates: string[];
  technicalPeriod: { startDate: string; endDate: string };
  limitations: string[]; days: OperationalDay[];
};

export type CoverageReport = {
  status: CoverageAnalysis["status"];
  context: { branchCode: string; visibleMonth: string | null; revision: number | null; runtime: string | null;
    kind: "SAVED" | "PROPOSAL" | "UNKNOWN"; restRulesVersion: number; dates: string[];
    technicalPeriod: { startDate: string; endDate: string }; basis: CoverageAnalysis["basis"] };
  limitations: string[];
  nominal: CoverageAnalysis["nominal"];
  nominalBySector: { sector: string; nominal: CoverageAnalysis["nominal"] }[];
  rows: {
    sector: string; ruler: "CONFIRMED" | "ESTIMATED";
    label: "Mínimo informado" | "Referência estimada de cobertura";
    status: "NO_REFERENCE" | "UNKNOWN" | "COVERED" | "GAP";
    requiredPersonMinutes: number | null; coveredPersonMinutes: number | null; deficitPersonMinutes: number | null;
    /** Dimensional conversion only; consumers round at display time, never per slice. */
    deficitHours: number | null; deficitRate: number | null;
    minutesWithGap: number | null; daysWithGap: number | null; daysWithoutTimedWork: number | null;
    unknownDates: string[];
    peak: null | { date: string; start: number; end: number; durationMinutes: number;
      required: number; presentTimed: number; missing: number; sectorMissing: number; roleMissing: number;
      limitingRoles: { role: string; required: number; present: number; missing: number }[];
      observed: OperationalCounts | null;
      afterConfiguredClosing: boolean;
      /** Optimistic local bound at the start instant; not a claim of global feasibility. */
      supply: { status: "UNKNOWN" | "WITHIN_LOCAL_UPPER_BOUND" | "REFERENCE_EXCEEDS_LOCAL_UPPER_BOUND";
        instant: number; potentialTimedPeople: number | null;
        limitingRoles: { role: string; required: number; potentialPeople: number }[] } };
  }[];
};

/** Implementation entry points: buildCoverageReport(referenceInput, candidateInput, options?) in coverage-report.ts;
 * analyzeOperational(input, options?) in operational-analysis.ts. Both are pure and never prepare targets or generate assignments. */
