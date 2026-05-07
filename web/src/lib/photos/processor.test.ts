import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildPhotoZip,
  PhotoProcessingError,
  processPhoto,
} from "@/lib/photos/processor";
import type { PhotoSettings } from "@/lib/photos/schema";

const settings: PhotoSettings = {
  width: 354,
  height: 472,
  quality: 90,
  format: "original",
  contrast: 1,
  brightness: 1,
  addBorder: false,
  borderWidth: 5,
  borderColor: "black",
  replaceOriginal: false,
  convertToJpg: false,
};

async function makeImageBuffer() {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: "#80a8d8",
    },
  })
    .jpeg()
    .toBuffer();
}

describe("photo processor", () => {
  it("crops and resizes an individual photo to 3x4 output", async () => {
    const photo = await processPhoto(
      {
        name: "José teste.png",
        type: "image/png",
        buffer: await makeImageBuffer(),
      },
      settings,
      { x: 120, y: 40, width: 360, height: 480 },
    );

    const metadata = await sharp(photo.buffer).metadata();

    expect(photo.fileName).toBe("Jose-teste_editado.png");
    expect(photo.contentType).toBe("image/png");
    expect(metadata.width).toBe(354);
    expect(metadata.height).toBe(472);
  });

  it("rejects unsupported image content types before decoding", async () => {
    await expect(
      processPhoto(
        {
          name: "foto.svg",
          type: "image/svg+xml",
          buffer: Buffer.from("<svg />"),
        },
        settings,
      ),
    ).rejects.toBeInstanceOf(PhotoProcessingError);
  });

  it("generates a zip with processed photos", async () => {
    const photo = await processPhoto(
      {
        name: "foto.jpg",
        type: "image/jpeg",
        buffer: await makeImageBuffer(),
      },
      settings,
    );

    const zipBuffer = await buildPhotoZip([photo]);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(Object.keys(zip.files)).toEqual(["foto_editado.jpg"]);
  });

  it("can force JPG output and replace the original file name", async () => {
    const photo = await processPhoto(
      {
        name: "foto.png",
        type: "image/png",
        buffer: await makeImageBuffer(),
      },
      {
        ...settings,
        replaceOriginal: true,
        convertToJpg: true,
      },
    );

    expect(photo.fileName).toBe("foto.jpg");
    expect(photo.contentType).toBe("image/jpeg");
  });

  it("keeps duplicate output names unique inside the zip", async () => {
    const photo = await processPhoto(
      {
        name: "foto.jpg",
        type: "image/jpeg",
        buffer: await makeImageBuffer(),
      },
      settings,
    );

    const zipBuffer = await buildPhotoZip([photo, photo]);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(Object.keys(zip.files)).toEqual([
      "foto_editado.jpg",
      "foto_editado-2.jpg",
    ]);
  });

  it("applies legacy-style brightness, contrast and border settings", async () => {
    const photo = await processPhoto(
      {
        name: "foto.jpg",
        type: "image/jpeg",
        buffer: await makeImageBuffer(),
      },
      {
        ...settings,
        contrast: 1.2,
        brightness: 1.1,
        addBorder: true,
        borderWidth: 5,
      },
    );

    const metadata = await sharp(photo.buffer).metadata();

    expect(metadata.width).toBe(364);
    expect(metadata.height).toBe(482);
  });
});
