import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import { cropWorkspacePages } from "./pdf-organizer-crop";
import type { WorkspacePage } from "./pdf-organizer-workspace-model";

const page: WorkspacePage = {
  id: "first", artifactId: "source", sourcePage: 1, rotation: 0, fileName: "documento.pdf",
};
function documents(rotation = 0) {
  return new Map([["source", { getPage: vi.fn().mockResolvedValue({
    rotate: rotation, view: [20, 30, 3284, 1215],
  }) } as unknown as PDFDocumentProxy]]);
}

describe("workspace crop snapshot", () => {
  it("crops selected pages using the visible box without changing other pages", async () => {
    const other = { ...page, id: "second" };
    const result = await cropWorkspacePages([page, other], new Set([page.id]),
      { top: 10, right: 10, bottom: 10, left: 10 }, documents());
    expect(result[0].crop).toEqual({ x: 326.4, y: 118.5, width: 2611.2000000000003, height: 948 });
    expect(result[1]).toBe(other);
    expect(page.crop).toBeUndefined();
  });

  it("maps displayed margins through the source and user rotations", async () => {
    const result = await cropWorkspacePages([{ ...page, rotation: 90 }], new Set([page.id]),
      { top: 10, right: 20, bottom: 30, left: 40 }, documents(90));
    expect(result[0].crop?.x).toBeCloseTo(652.8);
    expect(result[0].crop?.y).toBeCloseTo(118.5);
    expect(result[0].crop?.width).toBeCloseTo(1305.6);
    expect(result[0].crop?.height).toBeCloseTo(711);
  });

  it("rejects a missing document or an empty maintained area", async () => {
    await expect(cropWorkspacePages([page], new Set([page.id]),
      { top: 0, right: 0, bottom: 0, left: 0 }, new Map())).rejects.toThrow("não está disponível");
    await expect(cropWorkspacePages([page], new Set([page.id]),
      { top: 0, right: 60, bottom: 0, left: 40 }, documents())).rejects.toThrow("maiores que zero");
  });
});
