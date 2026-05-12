import {
  getInitialCropFromCroppedAreaPixels,
  type Area,
  type MediaSize,
  type Size,
} from "react-easy-crop";

export type PhotoCropGeometry = {
  key: string | null;
  mediaSize: MediaSize | null;
  cropSize: Size | null;
};

type PendingFaceCropInput = {
  selectedKey: string | null;
  cropMode: "auto" | "manual";
  pendingFaceArea: Area | null;
  geometry: PhotoCropGeometry;
};

export function getPendingFaceCropInitialization({
  selectedKey,
  cropMode,
  pendingFaceArea,
  geometry,
}: PendingFaceCropInput) {
  if (
    !selectedKey ||
    cropMode !== "manual" ||
    !pendingFaceArea ||
    geometry.key !== selectedKey ||
    !geometry.mediaSize ||
    !geometry.cropSize
  ) {
    return null;
  }

  return getInitialCropFromCroppedAreaPixels(
    pendingFaceArea,
    geometry.mediaSize,
    0,
    geometry.cropSize,
    1,
    3,
  );
}
