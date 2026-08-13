import { describe, expect, it } from "vitest";
import { defaultPresenceTheme } from "@/lib/presence/schema";
import { parsePresenceTheme } from "@/lib/presence/theme";

describe("presence theme", () => {
  it("uses the safe default for missing or malformed legacy values", () => {
    expect(parsePresenceTheme(null)).toEqual(defaultPresenceTheme);
    expect(parsePresenceTheme({ preset: "CUSTOM" })).toEqual(
      defaultPresenceTheme,
    );
  });

  it("accepts only the controlled theme contract", () => {
    const theme = {
      preset: "GARDEN",
      cover: "NONE",
      accent: "GREEN",
      welcomeTitle: "Vamos celebrar",
    } as const;
    expect(parsePresenceTheme(theme)).toEqual(theme);
  });
});
