import { describe, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { escalaFailure } from "./http";
import { EscalaError } from "@/lib/escalas/errors";
describe("private scheduling error boundary", () => {
  it("preserves a structured domain denial", async () => {
    const response = escalaFailure(new EscalaError(403, "ESCALA_PROTECTED_INPUT", "Campos protegidos."));
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "ESCALA_PROTECTED_INPUT" } });
  });
  it("does not expose unexpected persistence errors or their private payload", async () => {
    const response = escalaFailure(new Error("PRIVATE_PAYLOAD_MUST_NOT_ESCAPE"));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("PRIVATE_PAYLOAD_MUST_NOT_ESCAPE");
  });
});
