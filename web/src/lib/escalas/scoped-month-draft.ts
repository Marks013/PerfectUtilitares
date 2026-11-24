import { canonicalBranchCode } from "./branch-code";
import { EscalaError } from "./errors";
import { planningMonthPeriod } from "./planning-calendar";
import type { EscalaInput } from "./types";

/** A new month may be prepared without claiming administrative approval. */
export function scopedMonthDraft(branch: string, month: string): EscalaInput {
  const branchCode = canonicalBranchCode(branch);
  if (!branchCode || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(branchCode)) {
    throw new EscalaError(400, "ESCALA_INVALID_INPUT", "Informe uma filial válida.");
  }
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month) || month < "2000-02" || month > "2099-11") {
    throw new EscalaError(400, "ESCALA_INVALID_INPUT", "Informe um mês válido para o planejamento.");
  }
  const calendar = { planningWeekStartsOn: "SUNDAY" as const };
  const period = planningMonthPeriod(month, calendar);
  return {
    ...calendar, ...period, schemaVersion: 1, branchCode, branchName: `Filial ${branchCode}`,
    visibleMonth: month, defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    needsRegeneration: true,
    policy: {
      source: "", reviewed: false, reviewedBy: "", validFrom: period.startDate, validUntil: period.endDate,
      weeklyLimit: 44, dailyLimitMinutes: 528, compensationAuthorized: false, normativeProfile: "CUSTOM",
      transitionWeekAccepted: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      allowShortMealSimulation: false, maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: true,
      calendarMode: "LOCAL", closedDates: [], holidayDates: [], authorizedHolidayDates: [],
      holidayRestAllowed: false, nightWorkReviewed: false,
    },
    employees: [], assignments: [], shifts: [], demands: [],
  };
}
