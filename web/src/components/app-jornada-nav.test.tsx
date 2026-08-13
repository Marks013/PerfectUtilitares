import { describe, expect, it, vi } from "vitest";
import { closeJornadaMenu } from "./app-jornada-nav";

describe("closeJornadaMenu", () => {
  it("recolhe o menu depois de selecionar uma opção", () => {
    const removeAttribute = vi.fn();
    const closest = vi.fn(() => ({ removeAttribute }));

    closeJornadaMenu({ closest } as unknown as HTMLElement);

    expect(closest).toHaveBeenCalledWith("details");
    expect(removeAttribute).toHaveBeenCalledWith("open");
  });
});
