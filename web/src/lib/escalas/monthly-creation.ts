import { applyLocalHolidayCalendar } from "./calendar";
import { addDays, monthBounds, visibleDates } from "./dates";
import type { EscalaInput } from "./types";

/** A technical overlap never changes which civil month a workspace represents. */
export function scheduledMonth(input: EscalaInput): string | undefined {
  if (input.visibleMonth) return input.visibleMonth;
  const dates = visibleDates(input);
  const month = dates[0]?.slice(0, 7);
  if (!month) return undefined;
  const bounds = monthBounds(month);
  return dates[0] === bounds.startDate && dates.at(-1) === bounds.endDate ? month : undefined;
}

export function precedingMonth(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

/** Copy recurring configuration; no dated commitments, attendance or holiday permissions. */
export function carryMonthlyConfiguration(target: EscalaInput, source: EscalaInput): EscalaInput {
  const { calendarProvenance: _previousCalendar, paidHolidayDates: _previousPaidDates, ...policy } = source.policy;
  const reviewCoversPeriod = policy.validFrom <= target.startDate && policy.validUntil >= target.endDate;
  return applyLocalHolidayCalendar({
    ...target, branchName: source.branchName, defaultWeeklyHours: source.defaultWeeklyHours,
    timeZone: source.timeZone, restRulesVersion: source.restRulesVersion,
    generationMode: source.generationMode, simulation: source.simulation,
    storeClosingMinutes: source.storeClosingMinutes, mixed42Sectors: source.mixed42Sectors,
    demands: [], needsRegeneration: true,
    policy: {
      ...policy,
      reviewed: reviewCoversPeriod && policy.reviewed, reviewedBy: reviewCoversPeriod ? policy.reviewedBy : "",
      validFrom: reviewCoversPeriod ? policy.validFrom : target.startDate,
      validUntil: reviewCoversPeriod ? policy.validUntil : target.endDate,
      limitContinuousWorkBlocks: policy.limitContinuousWorkBlocks ?? true,
      holidayDates: [], closedDates: [], authorizedHolidayDates: [], coverageReview: "SUGGESTED",
    },
  });
}
