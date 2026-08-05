import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const allowedKeys = new Set([
  "UNIMED_TEMPLATE_DIR",
  "UNIMED_ACCESS_ENV_FILE",
  "PDF_DATA_DIR",
  "POSTGRES_DATA_DIR",
]);
const [key, value] = process.argv.slice(2);
const target = path.resolve(process.env.ENV_FILE ?? ".env");
const temporary = `${target}.${process.pid}.tmp`;

try {
  if (!allowedKeys.has(key) || !value || /[\r\n]/.test(value)) {
    throw new Error("Chave ou valor inválido.");
  }
  const metadata = await stat(target);
  const original = await readFile(target, "utf8");
  const escaped = value.replaceAll('"', '\\"');
  const line = `${key}="${escaped}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const updated = pattern.test(original)
    ? original.replace(pattern, line)
    : `${original.replace(/\s*$/, "")}\n${line}\n`;
  await writeFile(temporary, updated, { mode: metadata.mode });
  await rename(temporary, target);
  console.log(`${key} atualizado em ${target}.`);
} catch (error) {
  await rm(temporary, { force: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
