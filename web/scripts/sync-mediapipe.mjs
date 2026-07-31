import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
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
const mode = process.argv[2] ?? "check";

if (!new Set(["check", "update"]).has(mode)) {
  throw new Error(`Modo invalido: ${mode}. Use check ou update.`);
}

if (!existsSync(source)) {
  throw new Error("@mediapipe/face_detection nao instalado");
}

const assetNames = readdirSync(source)
  .filter(
    (file) =>
      file.endsWith(".js") ||
      file.endsWith(".wasm") ||
      file.endsWith(".data") ||
      file.endsWith(".binarypb") ||
      file.endsWith(".tflite"),
  )
  .sort();

function filesMatch(left, right) {
  return existsSync(right) && readFileSync(left).equals(readFileSync(right));
}

function updateAssets() {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });

  for (const file of assetNames) {
    cpSync(join(source, file), join(target, file));
  }

  if (existsSync(legacyCascade)) {
    mkdirSync(dirname(legacyTarget), { recursive: true });
    cpSync(legacyCascade, legacyTarget);
  }

  console.log("Ativos do MediaPipe atualizados.");
}

function checkAssets() {
  const problems = [];
  const targetNames = existsSync(target) ? readdirSync(target).sort() : [];

  for (const file of assetNames) {
    if (!filesMatch(join(source, file), join(target, file))) {
      problems.push(`ausente ou desatualizado: ${file}`);
    }
  }

  for (const file of targetNames) {
    if (!assetNames.includes(file)) {
      problems.push(`arquivo inesperado: ${file}`);
    }
  }

  if (existsSync(legacyCascade) && !filesMatch(legacyCascade, legacyTarget)) {
    problems.push("haarcascade legado ausente ou desatualizado");
  }

  if (problems.length > 0) {
    throw new Error(
      `Ativos do MediaPipe fora de sincronia:\n- ${problems.join("\n- ")}\nExecute npm run sync:update.`,
    );
  }

  console.log(`Ativos do MediaPipe verificados (${assetNames.length} arquivos).`);
}

if (mode === "update") {
  updateAssets();
} else {
  checkAssets();
}
