import { describe, expect, it } from "vitest";
import { getPendingFaceCropInitialization } from "./editor-crop";

describe("getPendingFaceCropInitialization", () => {
  const faceArea = { x: 120, y: 160, width: 300, height: 400 };
  const geometry = {
    key: "foto-2.jpg",
    mediaSize: {
      width: 900,
      height: 1200,
      naturalWidth: 900,
      naturalHeight: 1200,
    },
    cropSize: { width: 360, height: 480 },
  };

  it("inicializa o recorte detectado quando uma foto do lote e aberta pela primeira vez", () => {
    const result = getPendingFaceCropInitialization({
      selectedKey: "foto-2.jpg",
      cropMode: "manual",
      pendingFaceArea: faceArea,
      geometry,
    });

    expect(result).not.toBeNull();
    expect(result?.zoom).toBeGreaterThanOrEqual(1);
    expect(result?.zoom).toBeLessThanOrEqual(3);
    expect(result?.crop.x).toEqual(expect.any(Number));
    expect(result?.crop.y).toEqual(expect.any(Number));
  });

  it("nao reaproveita geometria de outra foto", () => {
    const result = getPendingFaceCropInitialization({
      selectedKey: "foto-3.jpg",
      cropMode: "manual",
      pendingFaceArea: faceArea,
      geometry,
    });

    expect(result).toBeNull();
  });
});
