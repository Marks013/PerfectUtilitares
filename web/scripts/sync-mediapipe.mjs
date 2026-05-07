import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(root, "..");
const source = join(root, "node_modules", "@mediapipe", "face_detection");
const target = join(root, "public", "mediapipe", "face_detection");
const legacyCascade = join(
  workspaceRoot,
  "EditorFotos3x4",
  "src",
  "modules",
  "haarcascade_frontalface_default.xml",
);
const legacyTarget = join(root, "public", "legacy", "haarcascade_frontalface_default.xml");

if (!existsSync(source)) {
  throw new Error("@mediapipe/face_detection nao instalado");
}

mkdirSync(dirname(target), { recursive: true });
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });

for (const file of readdirSync(source)) {
  if (
    file.endsWith(".js") ||
    file.endsWith(".wasm") ||
    file.endsWith(".data") ||
    file.endsWith(".binarypb") ||
    file.endsWith(".tflite")
  ) {
    cpSync(join(source, file), join(target, file));
  }
}

if (existsSync(legacyCascade)) {
  mkdirSync(dirname(legacyTarget), { recursive: true });
  cpSync(legacyCascade, legacyTarget);
}

console.log("MediaPipe face detection assets synced");
