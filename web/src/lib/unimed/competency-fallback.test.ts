import { describe, expect, it, vi } from "vitest";
import {
  findInLatestTwoCompetencies,
  findWithPreviousCompetencyFallback,
} from "@/lib/unimed/competency-fallback";

describe("Unimed competency fallback", () => {
  const competencies = [{ id: "latest" }, { id: "previous" }];

  it("stops on the latest competency when it contains the employee", async () => {
    const load = vi.fn(async (id: string) => (id === "latest" ? ["employee"] : []));
    const result = await findInLatestTwoCompetencies(competencies, load);
    expect(result).toEqual({ competency: competencies[0], items: ["employee"] });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("uses the immediately previous competency when the latest has no result", async () => {
    const load = vi.fn(async (id: string) => (id === "previous" ? ["employee"] : []));
    const result = await findInLatestTwoCompetencies(competencies, load);
    expect(result).toEqual({ competency: competencies[1], items: ["employee"] });
    expect(load.mock.calls.map(([id]) => id)).toEqual(["latest", "previous"]);
  });

  it("never checks more than two competencies", async () => {
    const load = vi.fn(async () => [] as string[]);
    const result = await findInLatestTwoCompetencies(
      [...competencies, { id: "archived" }],
      load,
    );
    expect(result).toEqual({ competency: competencies[0], items: [] });
    expect(load).toHaveBeenCalledTimes(2);
  });

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
