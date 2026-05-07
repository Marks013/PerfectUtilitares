import { describe, expect, it } from "vitest";
import { createFaceCropArea } from "./face-crop";

describe("createFaceCropArea", () => {
  it("expande a caixa do rosto mantendo proporcao 3x4", () => {
    const area = createFaceCropArea(
      { xCenter: 0.5, yCenter: 0.32, width: 0.18, height: 0.22 },
      1200,
      1600,
      3 / 4,
    );

    expect(area.width / area.height).toBeCloseTo(3 / 4, 2);
    expect(area.width).toBeGreaterThan(216);
    expect(area.height).toBeGreaterThan(352);
  });

  it("mantem crop dentro da imagem quando o rosto esta na borda", () => {
    const area = createFaceCropArea(
      { xCenter: 0.08, yCenter: 0.08, width: 0.16, height: 0.16 },
      900,
      1200,
      3 / 4,
    );

    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.y).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width).toBeLessThanOrEqual(900);
    expect(area.y + area.height).toBeLessThanOrEqual(1200);
  });
});
