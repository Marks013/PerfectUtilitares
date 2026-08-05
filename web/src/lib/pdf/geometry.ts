export type QuarterTurn = 0 | 90 | 180 | 270;

export type CropMargins = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type PdfBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type NormalizedPoint = { x: number; y: number };

export function normalizeQuarterTurn(angle: number): QuarterTurn {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalized as QuarterTurn;
}

export function combinePageRotation(
  sourceRotation: number,
  userRotation: QuarterTurn,
): QuarterTurn {
  return normalizeQuarterTurn(sourceRotation + userRotation);
}

/** Maps margins seen by the user back to the unrotated PDF coordinate space. */
export function displayMarginsToSource(
  rotation: QuarterTurn,
  margins: CropMargins,
): CropMargins {
  if (rotation === 90) {
    return {
      bottom: margins.left,
      left: margins.top,
      right: margins.bottom,
      top: margins.right,
    };
  }
  if (rotation === 180) {
    return {
      bottom: margins.top,
      left: margins.right,
      right: margins.left,
      top: margins.bottom,
    };
  }
  if (rotation === 270) {
    return {
      bottom: margins.right,
      left: margins.bottom,
      right: margins.top,
      top: margins.left,
    };
  }
  return { ...margins };
}

export function sourceMarginsToDisplay(
  rotation: QuarterTurn,
  margins: CropMargins,
): CropMargins {
  return displayMarginsToSource(normalizeQuarterTurn(360 - rotation), margins);
}

/**
 * Converts a normalized top-left display point into PDF user-space coordinates.
 * The box may be a pre-existing CropBox with a non-zero origin.
 */
export function displayPointToPdf(
  point: NormalizedPoint,
  box: PdfBox,
  rotation: QuarterTurn,
): NormalizedPoint {
  if (rotation === 90) {
    return {
      x: box.x + point.y * box.width,
      y: box.y + point.x * box.height,
    };
  }
  if (rotation === 180) {
    return {
      x: box.x + (1 - point.x) * box.width,
      y: box.y + point.y * box.height,
    };
  }
  if (rotation === 270) {
    return {
      x: box.x + (1 - point.y) * box.width,
      y: box.y + (1 - point.x) * box.height,
    };
  }
  return {
    x: box.x + point.x * box.width,
    y: box.y + (1 - point.y) * box.height,
  };
}

export function displayRectToPdf(
  rect: { height: number; width: number; x: number; y: number },
  box: PdfBox,
  rotation: QuarterTurn,
) {
  const points = [
    displayPointToPdf({ x: rect.x, y: rect.y }, box, rotation),
    displayPointToPdf(
      { x: rect.x + rect.width, y: rect.y },
      box,
      rotation,
    ),
    displayPointToPdf(
      { x: rect.x, y: rect.y + rect.height },
      box,
      rotation,
    ),
    displayPointToPdf(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      box,
      rotation,
    ),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    height: Math.max(...ys) - y,
    width: Math.max(...xs) - x,
    x,
    y,
  };
}

export function displaySize(box: PdfBox, rotation: QuarterTurn) {
  return rotation === 90 || rotation === 270
    ? { height: box.width, width: box.height }
    : { height: box.height, width: box.width };
}
