import { describe, expect, it } from "vitest";
import { PHOTO_DEFAULTS } from "./schema";
import { parseBatchCropAreas, parsePhotoSettings } from "./request";

describe("parsePhotoSettings", () => {
  it("forces 3x4 output and preserves original file names", () => {
    const formData = new FormData();
    formData.set("width", "900");
    formData.set("height", "900");
    formData.set("format", "jpeg");
    formData.set("replaceOriginal", "false");

    const settings = parsePhotoSettings(formData);

    expect(settings.width).toBe(PHOTO_DEFAULTS.width);
    expect(settings.height).toBe(PHOTO_DEFAULTS.height);
    expect(settings.replaceOriginal).toBe(true);
  });
});

describe("parseBatchCropAreas", () => {
  it("parses crop areas by original file name for batch processing", () => {
    const formData = new FormData();
    formData.set(
      "crops",
      JSON.stringify({
        "ARILIG - HIPER.jpeg": { x: 10, y: 20, width: 300, height: 400 },
      }),
    );

    const crops = parseBatchCropAreas(formData);

    expect(crops["ARILIG - HIPER.jpeg"]).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
  });
});
