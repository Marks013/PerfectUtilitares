import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keepLimit = Number(process.env.ARTIFACT_KEEP_LIMIT ?? "5");

const removableDirs = [
  ".next/cache",
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

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function removeTarget(target) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(root, target)}`);
}

for (const relativePath of removableDirs) {
  const target = safeResolve(relativePath);
  if (statOrNull(target)) {
    removeTarget(target);
  }
}

for (const relativePath of rotatedDirs) {
  const target = safeResolve(relativePath);
  const stat = statOrNull(target);
  if (!stat?.isDirectory()) {
    continue;
  }

  const entries = fs
    .readdirSync(target)
    .map((name) => {
      const entryPath = path.join(target, name);
      const entryStat = statOrNull(entryPath);
      return entryStat ? { name, path: entryPath, mtimeMs: entryStat.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries.slice(Math.max(0, keepLimit))) {
    removeTarget(entry.path);
  }
}
