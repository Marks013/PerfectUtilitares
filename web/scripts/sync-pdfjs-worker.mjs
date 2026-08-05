import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const packageDirectory = path.join(
  projectDirectory,
  "node_modules",
  "pdfjs-dist",
);
const destinationDirectory = path.join(
  projectDirectory,
  "public",
  "vendor",
  "pdfjs",
);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(
  path.join(packageDirectory, "build", "pdf.worker.min.mjs"),
  path.join(destinationDirectory, "pdf.worker.min.mjs"),
);

for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = path.join(destinationDirectory, directory);
  await rm(destination, { force: true, recursive: true });
  await cp(path.join(packageDirectory, directory), destination, {
    force: true,
    recursive: true,
  });
}

console.log("PDF.js worker, CMaps, fontes padrão e WASM sincronizados.");
