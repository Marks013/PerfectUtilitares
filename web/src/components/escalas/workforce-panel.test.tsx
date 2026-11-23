import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EscalaWorkforcePanel } from "./workforce-panel";
import { applyWorkforceImport, changeWorkforce, previewWorkforceImport, readWorkforce } from "./workforce-panel-client";

const signal = new AbortController().signal;
const employee = { registration: "0007", name: "Pessoa A", sector: "Caixa", role: "Operador", activeFrom: "2026-12-01" };
const person = { branchCode: "02", employee, dismissedFrom: null };
const absence = { registration: "0007", startDate: "2026-12-02", endDate: null, source: "FPHI105" };
const snapshot = { revision: 3, people: [person], catalogs: [{ branchCode: "02" }], absences: [absence] };
const file = new File(["synthetic"], "FPRE136.CSV", { type: "text/csv" });
const preview = { revision: 3, impactHash: "c".repeat(64), branchCodes: ["02", "03"], rowCount: 2, canApply: true, changed: true };

afterEach(() => vi.unstubAllGlobals());

describe("workforce panel", () => {
  it("identifies the selected branch and loading state without presenting stored people on the initial render", () => {
    expect(renderToStaticMarkup(<EscalaWorkforcePanel branchCode="" canImport={false} />)).toBe("");
    const html = renderToStaticMarkup(<EscalaWorkforcePanel branchCode="02" canImport={false} />);
    expect(html).toContain("Base de pessoal · filial 02");
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando a base de pessoal");
    expect(html).not.toContain("Confirmar importação");
  });

  it("reads only the selected branch without copying reports or reasons to fields used by the UI", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...snapshot, absences: [{ ...absence, reason: "privado" }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(readWorkforce("2", signal)).resolves.toEqual(snapshot);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/escalas/workforce?branchCode=02", { signal, cache: "no-store" });
  });

  it.each([
    { ...snapshot, people: [{ ...person, branchCode: "03" }] },
    { ...snapshot, catalogs: [{ branchCode: "03" }] },
    { ...snapshot, absences: [{ ...absence, registration: "0008" }] },
  ])("rejects workforce data outside the selected branch", async outside => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(outside)));
    await expect(readWorkforce("02", signal)).rejects.toThrow("filial selecionada");
  });

  it("preserves the textual registration, expected revision and indefinite absence in a branch edit", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ revision: 4, changed: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(changeWorkforce("02", 3, {
      action: "SET_ABSENCE", registration: "0007", startDate: "2026-12-02", endDate: null, previousStartDate: "2026-12-01",
    }, signal)).resolves.toEqual({ revision: 4, changed: true });
    const [, request] = fetch.mock.calls[0];
    expect(request).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, signal });
    expect(JSON.parse(request.body)).toEqual({
      action: "SET_ABSENCE", branchCode: "02", expectedRevision: 3, registration: "0007",
      startDate: "2026-12-02", endDate: null, previousStartDate: "2026-12-01",
    });
  });

  it("posts the same file, revisions, corrections and impact hash from preview to confirmation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ preview: { ...preview, missingRegistrations: [{ line: 10, branchCode: "03", resolved: true }] } }))
      .mockResolvedValueOnce(Response.json({ revision: 4, changed: true }));
    vi.stubGlobal("fetch", fetch);
    const corrections = [{ line: 10, registration: "0008" }];
    const report = await previewWorkforceImport(file, "EMPLOYEES", corrections, signal);
    expect(report.branchCodes).toEqual(["02", "03"]);
    await expect(applyWorkforceImport(file, "EMPLOYEES", corrections, report, signal)).resolves.toEqual({ revision: 4, changed: true });
    for (const [i, payload] of [
      { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES", registrationCorrections: corrections },
      { action: "IMPORT_APPLY", purpose: "EMPLOYEES", registrationCorrections: corrections, expectedRevision: 3, impactHash: preview.impactHash },
    ].entries()) {
      const [url, request] = fetch.mock.calls[i];
      expect(url).toBe("/api/escalas/workforce");
      expect(request).toMatchObject({ method: "POST", signal });
      const form = request.body as FormData;
      expect(form.get("file")).toBe(file);
      expect(JSON.parse(String(form.get("command")))).toEqual(payload);
    }
  });

  it.each([
    { ...preview, canApply: false },
    { ...preview, changed: false },
    { ...preview, missingRegistrations: [{ line: 10, resolved: false }] },
  ])("does not send a blocked, unchanged or incomplete import", blocked => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => applyWorkforceImport(file, "EMPLOYEES", [], blocked, signal)).toThrow("Confira o arquivo");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a revision conflict visible to the user instead of retrying the write", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: "Confira uma nova prévia." } }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(applyWorkforceImport(file, "ABSENCES", [], preview, signal)).rejects.toThrow("Confira uma nova prévia.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
