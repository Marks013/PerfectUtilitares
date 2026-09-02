import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = [
  path.resolve("src/lib"),
  path.resolve("src/components"),
  path.resolve("src/app/styles"),
];
const BASELINE_PATH = path.resolve("module-size-baseline.json");
const extensions = new Set([".css", ".ts", ".tsx"]);
const entries = [];

const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const warningLines = Number(baseline.warningLines);
const defaultMaxLines = Number(baseline.defaultMaxLines);
const exceptions = baseline.exceptions ?? {};

if (
  !Number.isSafeInteger(warningLines) ||
  !Number.isSafeInteger(defaultMaxLines) ||
  warningLines < 1 ||
  defaultMaxLines < warningLines
) {
  throw new Error("module-size-baseline.json possui limites inválidos.");
}

async function visit(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);

    if (item.isDirectory()) {
      if (item.name !== "generated") await visit(absolute);
      continue;
    }

    if (
      !extensions.has(path.extname(item.name)) ||
      item.name.includes(".test.")
    ) {
      continue;
    }

    const file = path.relative(process.cwd(), absolute);
    const lines = (await readFile(absolute, "utf8")).split(/\r?\n/).length;
    const exception = exceptions[file];
    const maxLines = exception?.maxLines ?? defaultMaxLines;

    if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
      throw new Error(`Limite inválido para ${file}.`);
    }

    entries.push({
      file,
      lines,
      maxLines,
      isException: Boolean(exception),
      reason: exception?.reason ?? null,
    });
  }
}

for (const root of ROOTS) {
  await visit(root);
}

const knownFiles = new Set(entries.map((entry) => entry.file));
const missingExceptions = Object.keys(exceptions).filter(
  (file) => !knownFiles.has(file),
);

if (missingExceptions.length > 0) {
  console.error("ERRO: exceções apontam para arquivos inexistentes:");
  for (const file of missingExceptions) console.error(`- ${file}`);
  process.exit(1);
}

const warnings = entries
  .filter((entry) => entry.lines > warningLines)
  .sort((left, right) => right.lines - left.lines);

const failures = entries.filter((entry) => entry.lines > entry.maxLines);
const removableExceptions = entries.filter(
  (entry) => entry.isException && entry.lines <= defaultMaxLines,
);

for (const entry of warnings) {
  const suffix = entry.isException
    ? `; baseline temporário ${entry.maxLines}`
    : `; limite ${entry.maxLines}`;
  console.warn(`[module-size] ${entry.file}: ${entry.lines} linhas${suffix}`);
}

if (removableExceptions.length > 0) {
  console.warn("AVISO: estas exceções já podem ser removidas do baseline:");
  for (const entry of removableExceptions) {
    console.warn(`- ${entry.file}: ${entry.lines} linhas`);
  }
}

if (failures.length > 0) {
  console.error("ERRO: módulos excederam seus limites de crescimento:");
  for (const entry of failures) {
    console.error(
      `- ${entry.file}: ${entry.lines} linhas; máximo ${entry.maxLines}`,
    );
  }
  process.exit(1);
}

console.log(
  `OK: ${entries.length} módulos verificados; ` +
    `${Object.keys(exceptions).length} exceção(ões) legada(s) sem crescimento.`,
);
