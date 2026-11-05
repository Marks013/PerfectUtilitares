import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const lockfiles = [
  "ops/escalas/requirements.txt",
  "ops/pdf-worker/runtime-requirements.txt",
  "ops/pdf-worker/office-requirements.txt",
];

export function readPythonPins(text) {
  const pins = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([\w.-]+)==([^\s;]+)(?:\s+--hash=sha256:[a-f0-9]{64})*$/.exec(line);
    if (!match) throw new Error("O lock Python contém uma dependência não fixada.");
    pins.push({ name: match[1], version: match[2] });
  }
  if (!pins.length) throw new Error("O lock Python não contém dependências.");
  return pins;
}

export async function auditPythonPins(pins, request = fetch) {
  const response = await request("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: pins.map(({ name, version }) => ({
        package: { ecosystem: "PyPI", name },
        version,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("A consulta de segurança Python falhou.");
  const body = await response.json();
  if (!Array.isArray(body.results) || body.results.length !== pins.length) {
    throw new Error("A consulta de segurança Python retornou dados incompletos.");
  }
  return body.results.flatMap((result, index) => {
    if (!result || typeof result !== "object" || result.error ||
      (result.vulns !== undefined && !Array.isArray(result.vulns))) {
      throw new Error("A consulta de segurança Python retornou um resultado inválido.");
    }
    return (result.vulns ?? []).map((issue) => {
      if (typeof issue.id !== "string") {
        throw new Error("A consulta de segurança Python retornou um aviso inválido.");
      }
      return { ...pins[index], id: issue.id };
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const versions = new Map();
    for (const file of lockfiles) {
      for (const pin of readPythonPins(await readFile(file, "utf8"))) {
        versions.set(pin.name.toLowerCase().replace(/[-_.]+/g, "-") + "@" + pin.version, pin);
      }
    }
    const pins = [...versions.values()];
    const issues = await auditPythonPins(pins);
    for (const issue of issues) console.error(`${issue.name}@${issue.version}: ${issue.id}`);
    if (issues.length) process.exitCode = 1;
    else console.log(`OK: ${pins.length} dependências Python fixadas, sem avisos conhecidos no OSV.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha na auditoria Python.");
    process.exitCode = 1;
  }
}
