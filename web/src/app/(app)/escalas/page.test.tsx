import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ redirect: vi.fn((target: string) => { throw new Error("REDIRECT:" + target); }) }));
import EscalasAliasPage from "./page";
describe("legacy Escalas address", () => {
  it("keeps old links on the one canonical workspace", () => { expect(() => EscalasAliasPage()).toThrow("REDIRECT:/escala"); });
});
