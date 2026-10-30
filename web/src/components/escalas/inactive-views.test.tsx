import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEscalaDiagnostics } from "@/lib/escalas/diagnostics";
import type { EscalaValidation } from "@/lib/escalas/types";
import { newInput } from "./workspace-model";
import { Proposals, ValidationResults } from "./results";

vi.mock("@/lib/escalas/diagnostics", async importActual => {
  const actual = await importActual<typeof import("@/lib/escalas/diagnostics")>();
  return { ...actual, buildEscalaDiagnostics: vi.fn(actual.buildEscalaDiagnostics) };
});
const validation: EscalaValidation = { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null };
describe("inactive scheduling views", () => {
  beforeEach(() => { vi.mocked(buildEscalaDiagnostics).mockClear(); });
  it("does not calculate review diagnostics while its area is inactive", () => {
    const input = newInput("08", "Teste", "2026-11", 42);
    renderToStaticMarkup(<ValidationResults active={false} input={input} validation={validation} />);
    expect(buildEscalaDiagnostics).not.toHaveBeenCalled();
  });
  it("does not calculate an inactive proposal and computes it on the active view", () => {
    const input = newInput("08", "Teste", "2026-11", 42);
    const props = { input, generated: { result: { status: "FEASIBLE", message: "Pronto" }, proposalInput: input, validation }, disabled: false, onGenerated: vi.fn(), onDismiss: vi.fn() };
    renderToStaticMarkup(<Proposals {...props} active={false} />);
    expect(buildEscalaDiagnostics).not.toHaveBeenCalled();
    renderToStaticMarkup(<Proposals {...props} active />);
    expect(buildEscalaDiagnostics).toHaveBeenCalledTimes(1);
  });
});
