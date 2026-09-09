import { describe, expect, it, vi } from "vitest";
import {
  findWithPreviousCompetencyFallback,
} from "@/lib/unimed/competency-fallback";

describe("Unimed competency fallback", () => {
  const competencies = [{ id: "latest" }, { id: "previous" }];

  it("does not load the previous competency when the latest has a match", async () => {
    const load = vi.fn(async () => ["employee"]);
    const loadPrevious = vi.fn(async () => competencies[1]);
    const result = await findWithPreviousCompetencyFallback(
      competencies[0],
      load,
      loadPrevious,
    );
    expect(result).toEqual({ competency: competencies[0], items: ["employee"] });
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("loads only the immediately previous competency after an empty latest search", async () => {
    const load = vi.fn(async (id: string) =>
      id === "previous" ? ["employee"] : [],
    );
    const loadPrevious = vi.fn(async () => competencies[1]);
    const result = await findWithPreviousCompetencyFallback(
      competencies[0],
      load,
      loadPrevious,
    );
    expect(result).toEqual({ competency: competencies[1], items: ["employee"] });
    expect(load.mock.calls.map(([id]) => id)).toEqual(["latest", "previous"]);
    expect(loadPrevious).toHaveBeenCalledTimes(1);
  });
});
