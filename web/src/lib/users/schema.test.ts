import { describe, expect, it } from "vitest";
import {
  invitationAcceptSchema,
  invitationCreateSchema,
  userPatchSchema,
} from "@/lib/users/schema";

describe("user schemas", () => {
  it("normalizes invitation email", () => {
    const parsed = invitationCreateSchema.parse({
      tenantId: "cltenant001",
      email: " Operador@Local.Test ",
      name: "Operador",
      role: "OPERATOR",
    });

    expect(parsed).toMatchObject({
      email: "operador@local.test",
    });
  });

  it("rejects empty user patch", () => {
    const parsed = userPatchSchema.safeParse({});

    expect(parsed.success).toBe(false);
  });

  it("rejects passwords above bcrypt safe length", () => {
    const parsed = invitationAcceptSchema.safeParse({
      token: "a".repeat(32),
      password: "a".repeat(73),
    });

    expect(parsed.success).toBe(false);
  });
});
