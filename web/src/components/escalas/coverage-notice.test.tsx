import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaValidation } from "@/lib/escalas/types";
import { EstimatedCoverageNotice } from "./coverage-notice";

function validation(code?: string): EscalaValidation {
  return { valid: true, readyToPublish: false, minimumCoverageMargin: code ? -1 : 0, summaries: [],
    issues: code ? [{ code, severity: "PENDING", message: "Resultado já calculado." }] : [] };
}

describe("compact estimated coverage warning", () => {
  it("appears for a calculated estimated gap and offers the operational review action", () => {
    const onReview = vi.fn();
    const html = renderToStaticMarkup(<EstimatedCoverageNotice validation={validation("ESTIMATED_COVERAGE_GAP")} hasRoster onReview={onReview} />);
    expect(html).toContain("Há desfalques estimados.");
    expect(html).toContain("Ver setores e horários");
    expect(html).not.toContain("<section");
    expect(html).not.toContain("<details");
    expect(onReview).not.toHaveBeenCalled();
  });

  it("does not invent a gap from missing coverage information, a mandatory minimum or a negative margin alone", () => {
    for (const result of [null, validation(), validation("COVERAGE_PENDING"), validation("COVERAGE_DEFICIT")]) {
      expect(renderToStaticMarkup(<EstimatedCoverageNotice validation={result} hasRoster onReview={vi.fn()} />)).toBe("");
    }
  });

  it("hides old gap information after the scenario changes until a new result is calculated", () => {
    expect(renderToStaticMarkup(<EstimatedCoverageNotice validation={validation("ESTIMATED_COVERAGE_GAP")} hasRoster={false} onReview={vi.fn()} />)).toBe("");
    const html = renderToStaticMarkup(<EstimatedCoverageNotice validation={validation("ESTIMATED_COVERAGE_GAP")} hasRoster outdated onReview={vi.fn()} />);
    expect(html).toBe("");
  });
});
