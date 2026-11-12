import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { referenceExpiryNotice, referenceNotices } from "./reference-notices";

describe("advance reference expiry reminders", () => {
  it("classifies compensation evidence as a notice without changing operational errors", () => {
    const input = newInput("01", "Synthetic", "2026-11", 42);
    input.policy.compensationAuthorized = false;
    const before = structuredClone(input);
    const operational = ["DAILY_LIMIT", "MEAL_INTERVAL", "WEEKLY_REST", "STORE_CLOSING_EXCEEDED"].map(code => ({ code, severity: "ERROR" as const, message: code }));
    const result = referenceNotices([{ code: "COMPENSATION_REQUIRED", severity: "ERROR", message: "Documentary evidence" }, ...operational]);
    expect(result).toContainEqual(expect.objectContaining({ code: "COMPENSATION_REQUIRED", severity: "WARNING" }));
    for (const issue of operational) expect(result).toContainEqual(issue);
    expect(input).toEqual(before);
    expect(input.policy.compensationAuthorized).toBe(false);
  });
  it("warns within 30 days of the stored expiry without making up documentary approval", () => {
    const input = newInput("08", "Synthetic", "2027-05", 42);
    input.policy.normativeProfile = "SINDECOMU_SUPERMARKETS_2026_2027";
    input.endDate = "2027-05-30";
    const before = structuredClone(input);
    expect(referenceExpiryNotice(input)).toEqual([expect.objectContaining({ code: "CCT_EXPIRING", severity: "WARNING" })]);
    expect(input).toEqual(before);
    expect(referenceExpiryNotice({ ...input, endDate: "2027-04-30" })).toEqual([]);
    expect(referenceExpiryNotice({ ...input, endDate: "2027-06-06" })).toEqual([]);
    input.policy.normativeProfile = "CUSTOM";
    expect(referenceExpiryNotice(input)).toEqual([]);
  });
});
