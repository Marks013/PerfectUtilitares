import { describe, expect, it } from "vitest";
import {
  combinePageRotation,
  displayMarginsToSource,
  displayPointToPdf,
  displayRectToPdf,
  sourceMarginsToDisplay,
} from "@/lib/pdf/geometry";

describe("PDF page geometry", () => {
  it("combines source and user rotations", () => {
    expect(combinePageRotation(90, 90)).toBe(180);
    expect(combinePageRotation(270, 180)).toBe(90);
  });

  it("maps display crop margins to source coordinates", () => {
    const margins = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(displayMarginsToSource(0, margins)).toEqual(margins);
    expect(displayMarginsToSource(90, margins)).toEqual({
      bottom: 40,
      left: 10,
      right: 30,
      top: 20,
    });
    expect(displayMarginsToSource(180, margins)).toEqual({
      bottom: 10,
      left: 20,
      right: 40,
      top: 30,
    });
    expect(displayMarginsToSource(270, margins)).toEqual({
      bottom: 20,
      left: 30,
      right: 10,
      top: 40,
    });
    expect(
      sourceMarginsToDisplay(90, displayMarginsToSource(90, margins)),
    ).toEqual(margins);
  });

  it("maps display points through rotation and a non-zero CropBox", () => {
    const box = { x: 20, y: 30, width: 200, height: 100 };
    expect(displayPointToPdf({ x: 0.25, y: 0.4 }, box, 0)).toEqual({
      x: 70,
      y: 90,
    });
    expect(displayPointToPdf({ x: 0.25, y: 0.4 }, box, 90)).toEqual({
      x: 100,
      y: 55,
    });
    expect(displayPointToPdf({ x: 0.25, y: 0.4 }, box, 180)).toEqual({
      x: 170,
      y: 70,
    });
    expect(displayPointToPdf({ x: 0.25, y: 0.4 }, box, 270)).toEqual({
      x: 140,
      y: 105,
    });
  });

  it("maps display rectangles to an axis-aligned PDF rectangle", () => {
    expect(
      displayRectToPdf(
        { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        { x: 20, y: 30, width: 200, height: 100 },
        90,
      ),
    ).toEqual({ x: 60, y: 40, width: 80, height: 30 });
  });
});
