import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/@mediapipe/tasks-vision");
const target = join(root, "public/mediapipe/tasks-vision");
const model = join(root, "public/mediapipe/models/blaze_face_short_range.tflite");
const modelUrl = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const modelHash = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
const mode = process.argv[2] ?? "check";
if (!["check", "update"].includes(mode)) throw new Error("Use check ou update.");
const assets = ["vision_bundle.mjs", ...readdirSync(join(source, "wasm")).filter((name) => /\.(js|wasm)$/.test(name)).map((name) => `wasm/${name}`)];
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");

if (mode === "update") {
  for (const asset of assets) {
    mkdirSync(dirname(join(target, asset)), { recursive: true });
    cpSync(join(source, asset), join(target, asset));
  }
  if (!existsSync(model) || digest(readFileSync(model)) !== modelHash) {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Falha ao obter modelo: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== modelHash) throw new Error("Hash inesperado do modelo facial.");
    mkdirSync(dirname(model), { recursive: true });
    writeFileSync(model, bytes);
  }
}

for (const asset of assets) {
  if (!existsSync(join(target, asset)) || !readFileSync(join(source, asset)).equals(readFileSync(join(target, asset)))) {
    throw new Error(`Ativo fora de sincronia: ${asset}. Execute npm run sync:mediapipe:update.`);
  }
}
if (!existsSync(model) || digest(readFileSync(model)) !== modelHash) throw new Error("Modelo facial ausente ou inválido.");
console.log(`MediaPipe Tasks Vision: ${assets.length} ativos e modelo verificados.`);
