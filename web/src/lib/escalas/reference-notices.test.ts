import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { referenceExpiryNotice } from "./reference-notices";

describe("advance reference expiry reminders", () => {
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
