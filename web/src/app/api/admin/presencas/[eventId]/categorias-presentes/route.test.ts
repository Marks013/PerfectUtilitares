import { describe, expect, it } from "vitest";
import {
  presenceGiftCategoryCreateSchema,
  presenceGiftCategoryOrderSchema,
} from "@/lib/presence/schema";

describe("admin presence gift categories collection route", () => {
  it("validates free category names, emoji and ordering", () => {
    expect(
      presenceGiftCategoryCreateSchema.safeParse({
        name: "Quarto do bebê",
        emoji: "🛏️",
      }).success,
    ).toBe(true);
    expect(
      presenceGiftCategoryOrderSchema.safeParse({ orderedIds: [] }).success,
    ).toBe(false);
  });
});
