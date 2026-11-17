import { describe, expect, it } from "vitest";
import { ROSTER_COLOR_LEGEND, ROSTER_STATE_COLORS, ROSTER_STATE_TEXT, rosterCellColors, rosterPdfColor, rosterStateIndex } from "./roster-colors";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(start => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("roster state palette", () => {
  it("strengthens only rest and holiday backgrounds", () => {
    expect(ROSTER_STATE_COLORS).toEqual(["#FFFFFF", "#86EFAC", "#DBEAFE", "#FCD34D", "#F3E8FF", "#FEE2E2", "#F1F5F9"]);
    expect(contrast(rosterCellColors("F").backgroundColor, "#FFFFFF")).toBeGreaterThan(contrast("#DCFCE7", "#FFFFFF"));
    expect(contrast(rosterCellColors("FE").backgroundColor, "#FFFFFF")).toBeGreaterThan(contrast("#FEF3C7", "#FFFFFF"));
  });

  it("keeps normal text readable on every state background", () => {
    expect(ROSTER_STATE_TEXT).toBe("#1E293B");
    for (const background of ROSTER_STATE_COLORS) expect(contrast(ROSTER_STATE_TEXT, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("preserves state mapping and textual distinction without relying on color", () => {
    for (const [code, index] of [["", 0], ["F", 1], ["ENC", 2], ["FE", 3], ["AF", 4], ["NP", 5], ["X", 6], ["FV", 6], ["08:00", 0]] as const) {
      expect(rosterStateIndex(code)).toBe(index);
      expect(rosterCellColors(code)).toEqual({ backgroundColor: ROSTER_STATE_COLORS[index], color: ROSTER_STATE_TEXT });
    }
    expect(ROSTER_COLOR_LEGEND).toBe("Cores: F verde; ENC azul; FE amarelo; AF lilás; NP rosa. Domingo só no cabeçalho; cargo na identificação.");
  });

  it("uses the exact shared RGB palette for PDF conversion", () => {
    for (const code of ["F", "FE", "ENC", "AF", "NP", "X", "FV", ""]) {
      const rgb = rosterPdfColor(code);
      expect(rgb.map(value => Math.round(value * 255).toString(16).padStart(2, "0")).join("").toUpperCase()).toBe(rosterCellColors(code).backgroundColor.slice(1));
    }
  });
});
