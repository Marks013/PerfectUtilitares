import { describe, expect, it } from "vitest";
import { presenceGiftCategoryUpdateSchema } from "@/lib/presence/schema";

describe("admin presence gift category item route", () => {
  it("requires at least one category change", () => {
    expect(presenceGiftCategoryUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      presenceGiftCategoryUpdateSchema.safeParse({ emoji: "🍳" }).success,
    ).toBe(true);
  });
});
