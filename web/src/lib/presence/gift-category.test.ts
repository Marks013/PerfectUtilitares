import { describe, expect, it } from "vitest";
import { normalizePresenceGiftCategoryName } from "@/lib/presence/gift-category";

describe("normalizePresenceGiftCategoryName", () => {
  it("normalizes accents, casing and repeated whitespace", () => {
    expect(normalizePresenceGiftCategoryName("  QUARTO   do Bebê ")).toBe(
      "quarto do bebe",
    );
  });
});
