import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const source = path.join(
  projectDirectory,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const destinationDirectory = path.join(
  projectDirectory,
  "public",
  "vendor",
  "pdfjs",
);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, path.join(destinationDirectory, "pdf.worker.min.mjs"));

console.log("PDF.js worker sincronizado.");
