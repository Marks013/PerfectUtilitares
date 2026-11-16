/** Day states only: neither Sunday nor a person's role overrides a saved cell code. */
export const ROSTER_STATE_COLORS = ["#FFFFFF", "#DCFCE7", "#DBEAFE", "#FEF3C7", "#F3E8FF", "#FEE2E2", "#F1F5F9"] as const;
export const ROSTER_STATE_TEXT = "#1E293B";
export const ROSTER_COLOR_LEGEND = "Cores: F verde; ENC azul; FE amarelo; AF lilás; NP rosa. Domingo só no cabeçalho; cargo na identificação.";

export function rosterStateIndex(code: string): number {
  return code === "F" ? 1 : code === "ENC" ? 2 : code === "FE" ? 3 : code === "AF" ? 4 : code === "NP" ? 5 : ["X", "FV"].includes(code) ? 6 : 0;
}

export function rosterCellColors(code: string) {
  return { backgroundColor: ROSTER_STATE_COLORS[rosterStateIndex(code)], color: ROSTER_STATE_TEXT };
}

export function rosterPdfColor(code: string): [number, number, number] {
  const hex = ROSTER_STATE_COLORS[rosterStateIndex(code)];
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number];
}
