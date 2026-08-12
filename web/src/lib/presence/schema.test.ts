import { describe, expect, it } from "vitest";
import {
  presenceAccessSchema,
  presencePublicRouteSchema,
} from "@/lib/presence/schema";

describe("presence schemas", () => {
  it("accepts a readable route with a cryptographic invitation token", () => {
    expect(
      presenceAccessSchema.safeParse({
        eventSlug: "casamento-ana-e-joao",
        guestSlug: "maico-rafael",
        token: `c_${"a".repeat(43)}`,
      }).success,
    ).toBe(true);
  });

  it("rejects unsafe or ambiguous slugs", () => {
    expect(
      presencePublicRouteSchema.safeParse({
        eventSlug: "Casamento Ana",
        guestSlug: "../admin",
      }).success,
    ).toBe(false);
  });
});
