import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const API_ROOT = path.resolve("src/app/api");
const BASELINE_PATH = path.resolve("route-test-baseline.json");

async function collectRoutes(directory, routes = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRoutes(absolute, routes);
    } else if (entry.name === "route.ts") {
      routes.push(absolute);
    }
  }
  return routes;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const baselineDocument = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const baseline = new Set(baselineDocument.legacyWithoutTests ?? []);
const routes = await collectRoutes(API_ROOT);
const missing = [];

for (const route of routes) {
  const directory = path.dirname(route);
  const hasTest =
    (await exists(path.join(directory, "route.test.ts"))) ||
    (await exists(path.join(directory, "route.spec.ts")));
  if (!hasTest) missing.push(path.relative(process.cwd(), route));
}
missing.sort();

const unexpected = missing.filter((route) => !baseline.has(route));
const resolved = [...baseline].filter((route) => !missing.includes(route));
const covered = routes.length - missing.length;

if (unexpected.length > 0 || resolved.length > 0) {
  if (unexpected.length > 0) {
    console.error("Rotas novas sem teste dedicado:");
    for (const route of unexpected) console.error(`- ${route}`);
  }
  if (resolved.length > 0) {
    console.error("Remova do baseline as rotas que agora possuem teste:");
    for (const route of resolved) console.error(`- ${route}`);
  }
  process.exit(1);
}

console.log(
  `OK: ${covered}/${routes.length} rotas possuem teste dedicado; ` +
    `${missing.length} débitos legados estão bloqueados contra crescimento.`,
);
