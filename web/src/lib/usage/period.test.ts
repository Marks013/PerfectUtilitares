import { describe, expect, it } from "vitest";
import { getUsageDate, getUsagePeriodRange } from "@/lib/usage/period";

describe("usage periods", () => {
  const instant = new Date("2026-07-30T01:30:00.000Z");

  it("uses the configured civil day instead of the UTC day", () => {
    expect(getUsageDate(instant, "America/Sao_Paulo").toISOString()).toBe(
      "2026-07-29T00:00:00.000Z",
    );
  });

  it.each([
    ["day", "2026-07-29T00:00:00.000Z", "2026-07-30T00:00:00.000Z"],
    ["month", "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
    ["year", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ] as const)("returns the current %s range", (period, start, end) => {
    expect(
      getUsagePeriodRange(period, instant, "America/Sao_Paulo"),
    ).toEqual({
      start: new Date(start),
      end: new Date(end),
    });
  });
});

