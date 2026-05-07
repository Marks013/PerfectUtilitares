import type { Area } from "react-easy-crop";

export type FaceBoundingBox = {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function createFaceCropArea(
  boundingBox: FaceBoundingBox,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
): Area {
  const faceWidth = boundingBox.width * imageWidth;
  const faceHeight = boundingBox.height * imageHeight;
  const faceCenterX = boundingBox.xCenter * imageWidth;
  const faceCenterY = boundingBox.yCenter * imageHeight;
  let width = Math.max(faceWidth * 2.45, faceHeight * 1.65);
  let height = width / aspect;

  if (height < faceHeight * 2.65) {
    height = faceHeight * 2.65;
    width = height * aspect;
  }

  width = Math.min(width, imageWidth);
  height = Math.min(height, imageHeight);

  if (width / height > aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  const centerY = faceCenterY + faceHeight * 0.42;
  const x = clamp(faceCenterX - width / 2, 0, imageWidth - width);
  const y = clamp(centerY - height / 2, 0, imageHeight - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}
