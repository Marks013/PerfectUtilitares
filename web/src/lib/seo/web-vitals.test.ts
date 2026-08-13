import { describe, expect, it } from "vitest";
import { percentile75, rateVital } from "./web-vitals";

describe("web vitals aggregation", () => {
  it("calculates the nearest-rank 75th percentile", () => {
    expect(percentile75([4, 1, 3, 2])).toBe(3);
    expect(percentile75([])).toBeNull();
  });

  it("rates core metrics using Web Vitals thresholds", () => {
    expect(rateVital("LCP", 2_500)).toBe("good");
    expect(rateVital("LCP", 3_000)).toBe("needs-improvement");
    expect(rateVital("CLS", 0.3)).toBe("poor");
    expect(rateVital("INP", null)).toBe("pending");
  });
});
