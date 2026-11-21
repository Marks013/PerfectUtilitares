import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { EscalaAccessProvider } from "./access-context";
import { ImportReplacement, replacementDateErrors } from "./import-replacement";

const workspace = { id: "plan", revision: 3, input: { branchCode: "07", branchName: "Centro", startDate: "2026-11-30", endDate: "2027-01-03", employees: [] } } as unknown as EscalaWorkspace;
const administrator: EscalaClientAccess = { channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] };
const render = (access: EscalaClientAccess | null, pendingSave = false) => renderToStaticMarkup(<EscalaAccessProvider value={access}><ImportReplacement workspace={workspace} purpose="EMPLOYEES" disabled={false} pendingSave={pendingSave} replaceImport={vi.fn()} onSave={vi.fn()} /></EscalaAccessProvider>);
describe("administrative replacement presentation", () => {
  it.each([
    ["2026-11-30", "", "end"],
    ["2026-11-30", "2027-01-04", "end"],
    ["2026-11-29", "2026-12-31", "start"],
    ["2026-12-31", "2026-12-01", "end"],
  ] as const)("associates invalid dates %s / %s only with %s", (start, end, field) => {
    const errors = replacementDateErrors(start, end, workspace.input);
    expect(errors[field]).toBeTruthy(); expect(errors[field === "start" ? "end" : "start"]).toBeUndefined();
  });
  it("identifies both missing dates and accepts the exact technical bounds", () => {
    expect(replacementDateErrors("", "", workspace.input)).toEqual({ start: "Informe a data inicial.", end: "Informe a data final." });
    expect(replacementDateErrors("2026-11-30", "2027-01-03", workspace.input)).toEqual({ start: undefined, end: undefined });
  });
  it("assigns an excessive duration to the end date without marking the valid start", () => {
    const errors = replacementDateErrors("2026-12-01", "2027-01-12", { startDate: "2026-12-01", endDate: "2027-01-31" });
    expect(errors.start).toBeUndefined(); expect(errors.end).toContain("42 dias");
  });
  it("fails closed for absent access, branch and scoped account", () => {
    expect(render(null)).toBe(""); expect(render({ ...administrator, channel: "USERNAME" })).toBe(""); expect(render({ ...administrator, allBranches: false })).toBe("");
  });
  it("requires file, complete coverage and a separate impact confirmation", () => {
    const html = render(administrator); expect(html).toContain("Declaro que o arquivo cobre integralmente"); expect(html).toContain("não libera arquivo identificado como parcial");
    expect(html.match(/<button[^>]*>Conferir substituição de equipe<\/button>/)?.[0]).toContain("disabled");
    expect(html).not.toContain("Confirmar e salvar substituição");
  });
  it("provides an explicit saved-draft prerequisite without importing into the local draft", () => {
    const html = render(administrator,true); expect(html).toContain("Salvar alterações antes de conferir");
    expect(html.match(/<button[^>]*>Conferir substituição de equipe<\/button>/)?.[0]).toContain("disabled");
  });
});
