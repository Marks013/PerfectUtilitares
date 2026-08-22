import { describe, expect, it } from "vitest";
import {
  competencyFromFileName,
  validateGeneration,
} from "./reajuste-salarial-workspace-model";

describe("salary adjustment workspace model", () => {
  it("recognizes competence and validates the form", () => {
    const file = new File(["xlsx"], "06-2026.xlsx");
    expect(competencyFromFileName(file.name)).toBe("06-2026");
    expect(validateGeneration([file], "4,42")).toEqual([]);
  });

  it("rejects legacy xls and duplicate competencies", () => {
    const first = new File(["x"], "06-2026.xlsx");
    const duplicate = new File(["y"], "06-2026.xlsx");
    const legacy = new File(["z"], "07-2026.xls");
    expect(validateGeneration([first, duplicate], "4,42")).toContain(
      "Não repita a mesma competência.",
    );
    expect(validateGeneration([legacy], "4,42")).toContain(
      "Somente arquivos .xlsx são aceitos.",
    );
  });
});
