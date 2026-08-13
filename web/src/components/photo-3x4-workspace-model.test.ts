import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadResult, type ResultFile } from "./photo-3x4-workspace-model";

describe("downloadResult", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("cria uma URL nova para cada download e a libera depois do clique", () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:primeiro")
      .mockReturnValueOnce("blob:segundo");
    const revokeObjectURL = vi.fn();
    const links: Array<{ href: string; download: string }> = [];

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => {
        const link = {
          href: "",
          download: "",
          click: vi.fn(),
          remove: vi.fn(),
        };
        links.push(link);
        return link;
      }),
    });

    const result: ResultFile = {
      blob: new Blob(["foto"]),
      fileName: "foto.jpg",
      label: "Foto",
    };
    downloadResult(result);
    downloadResult(result);

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(links.map((link) => link.href)).toEqual([
      "blob:primeiro",
      "blob:segundo",
    ]);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:primeiro");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:segundo");
  });
});
