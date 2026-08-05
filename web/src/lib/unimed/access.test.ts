import { describe, expect, it } from "vitest";
import { canUseUnimed } from "@/lib/unimed/access";

describe("Unimed permissions", () => {
  it("lets an operator calculate and send, but not publish", () => {
    const actor = { role: "OPERATOR", accessLevel: "OPERATOR" } as const;

    expect(canUseUnimed(actor, "CALCULATE")).toBe(true);
    expect(canUseUnimed(actor, "SEND_EMAIL")).toBe(true);
    expect(canUseUnimed(actor, "PUBLISH")).toBe(false);
  });

  it("lets a manager publish and manage settings, but not access", () => {
    const actor = { role: "OPERATOR", accessLevel: "MANAGER" } as const;

    expect(canUseUnimed(actor, "PUBLISH")).toBe(true);
    expect(canUseUnimed(actor, "MANAGE_CONFIG")).toBe(true);
    expect(canUseUnimed(actor, "MANAGE_ACCESS")).toBe(false);
  });

  it("denies users without an explicit Unimed grant", () => {
    expect(canUseUnimed({ role: "OPERATOR", accessLevel: null }, "VIEW")).toBe(
      false,
    );
  });

  it("keeps system administrators as break-glass administrators", () => {
    expect(
      canUseUnimed({ role: "ADMIN", accessLevel: null }, "MANAGE_ACCESS"),
    ).toBe(true);
  });
});
