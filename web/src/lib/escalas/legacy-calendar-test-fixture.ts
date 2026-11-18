import { newInput } from "../../components/escalas/workspace-model";
import { planningMonthPeriod } from "./planning-calendar";
import type { EscalaInput, WeeklyHours } from "./types";

/** Reproduce pre-calendar snapshots without changing the production Sunday default. */
export function newLegacyInput(branchCode: string, branchName: string, month: string, hours: WeeklyHours): EscalaInput {
  const input = newInput(branchCode, branchName, month, hours);
  const period = planningMonthPeriod(month, { planningWeekStartsOn: "MONDAY" });
  // Omitted metadata is the serialized legacy contract, including its original coverage fingerprints.
  delete input.planningWeekStartsOn;
  return { ...input, ...period, policy: { ...input.policy, validFrom: period.startDate, validUntil: period.endDate } };
}
