import { describe, expect, it } from "vitest";
import { presenceCover, presenceCoverOptions } from "@/lib/presence/cover";

describe("presence covers", () => {
  it("maps every visual option to a local asset or the explicit empty state", () => {
    expect(presenceCoverOptions).toHaveLength(6);
    expect(presenceCover("WEDDING").image).toBe(
      "/presence/covers/wedding.webp",
    );
    expect(presenceCover("NONE").image).toBeNull();
  });
});
