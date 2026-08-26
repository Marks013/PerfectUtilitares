import { describe, expect, it } from "vitest";
import { formatCompetency, formatVacationDate, readResponseError, validateVacationFile } from "./ferias-contract";

describe("Ferias client boundary", () => {
  it("keeps dates independent of browser timezone", () => {
    expect(formatCompetency("2026-09")).toBe("09/2026");
    expect(formatCompetency("Tabela atual")).toBe("Tabela atual");
    expect(formatVacationDate("2026-09-01")).toBe("01/09/2026");
    expect(formatVacationDate("Data indisponível")).toBe("Data indisponível");
  });

  it("rejects empty, oversized and unsupported files", () => {
    expect(validateVacationFile(new File([], "ferias.xlsx"))).toContain("vazia");
    expect(validateVacationFile(new File(["x"], "ferias.xlsm"))).toContain("XLSX");
    expect(validateVacationFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "ferias.xlsx"))).toContain("5 MB");
    expect(validateVacationFile(new File(["x"], "FERIAS.XLSX"))).toBeNull();
  });

  it("uses structured messages and safe fallbacks, never raw responses", async () => {
    expect(await readResponseError(Response.json({ error: { code: "BASE_MISSING", message: "Fatura de setembro não publicada." } }, { status: 422 }))).toBe("Fatura de setembro não publicada.");
    expect(await readResponseError(new Response("<h1>internal stack trace</h1>", { status: 409 }))).toContain("bases foram atualizadas");
    expect(await readResponseError(new Response("", { status: 403 }))).toContain("conta administrativa");
    expect(await readResponseError(Response.json({ error: { message: "" } }, { status: 500 }))).toContain("Tente novamente");
  });
});
