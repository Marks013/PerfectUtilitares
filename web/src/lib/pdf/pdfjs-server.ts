import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function pdfJsAssetUrl(directory: "cmaps" | "standard_fonts" | "wasm") {
  const packageDirectory = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return pathToFileURL(path.join(packageDirectory, directory) + path.sep).href;
}

export function pdfJsServerDocumentOptions(data: Uint8Array) {
  return {
    cMapPacked: true,
    cMapUrl: pdfJsAssetUrl("cmaps"),
    data,
    standardFontDataUrl: pdfJsAssetUrl("standard_fonts"),
    useSystemFonts: true,
    wasmUrl: pdfJsAssetUrl("wasm"),
  };
}
