import { describe, expect, it } from "vitest";
import { planningMonth } from "./planning-month";

describe("São Paulo planning month", () => {
  it.each([
    ["2026-12-01T02:30:00Z", "2026-11"],
    ["2026-12-01T03:00:00Z", "2026-12"],
    ["2027-01-01T02:59:59Z", "2026-12"],
    ["2027-01-01T03:00:00Z", "2027-01"],
  ])("uses the local calendar at %s", (instant, expected) => {
    expect(planningMonth(new Date(instant))).toBe(expected);
  });
});
