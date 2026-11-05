import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const configuredLimit = process.env.ARTIFACT_KEEP_LIMIT ?? "5";
const keepLimit = Number(configuredLimit);
if (!/^\d+$/.test(configuredLimit) || !Number.isSafeInteger(keepLimit)) {
  throw new Error("ARTIFACT_KEEP_LIMIT deve ser um inteiro não negativo.");
}

const removableDirs = [
  ".turbo",
  ".cache",
  ".tmp",
  "tmp",
  "temp",
];

const rotatedDirs = [
  ".deploy",
  "deploy-artifacts",
  "artifacts",
  "backups",
  "backup",
  "logs",
];

function safeResolve(relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe cleanup target: ${target}`);
  }
  return target;
}

function statEntry(target) {
  return fs.lstatSync(target, { throwIfNoEntry: false });
}

function removeTarget(target) {
  const parent = path.dirname(target);
  const actual = statEntry(target);
  if (!actual || (!actual.isDirectory() && !actual.isFile())) return;
  if (fs.realpathSync(parent) !== parent) {
    throw new Error(`Diretório de limpeza foi redirecionado: ${parent}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(root, target)}`);
}

for (const relativePath of removableDirs) {
  const target = safeResolve(relativePath);
  if (statEntry(target)?.isDirectory()) {
    removeTarget(target);
  }
}

for (const relativePath of rotatedDirs) {
  const target = safeResolve(relativePath);
  const stat = statEntry(target);
  if (!stat?.isDirectory()) {
    continue;
  }

  const entries = fs
    .readdirSync(target)
    .map((name) => {
      const entryPath = path.join(target, name);
      const entryStat = statEntry(entryPath);
      return entryStat?.isFile() || entryStat?.isDirectory()
        ? { path: entryPath, mtimeMs: entryStat.mtimeMs }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries.slice(keepLimit)) {
    removeTarget(entry.path);
  }
}
