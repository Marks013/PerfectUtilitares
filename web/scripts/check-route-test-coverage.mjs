import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const API_ROOT = path.resolve("src/app/api");
const BASELINE_PATH = path.resolve("route-test-baseline.json");
const SUCCESS_STATUS_PATTERN =
  /(?:response|result)\.status\)\.toBe\((?:200|201|202|204)\)/;

async function collectFiles(
  directory,
  predicate,
  files = [],
) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolute, predicate, files);
    } else if (predicate(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeRoute(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function manifestRoutes(source) {
  if (
    !source.includes("route-success:") ||
    !source.includes("expect(response.status).toBe(routeCase.expectedStatus)")
  ) {
    return [];
  }

  const routes = [];
  const pattern =
    /route:\s*["'](src\/app\/api\/[^"']+\/route\.ts)["'][\s\S]{0,120}?expectedStatus:\s*(200|201|202|204)/g;
  for (const match of source.matchAll(pattern)) {
    routes.push(match[1]);
  }
  return routes;
}

const baselineDocument = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const baseline = new Set(baselineDocument.legacyWithoutTests ?? []);
const routes = await collectFiles(API_ROOT, (name) => name === "route.ts");
const tests = await collectFiles(
  API_ROOT,
  (name) => name.endsWith(".test.ts") || name.endsWith(".spec.ts"),
);
const testSources = new Map(
  await Promise.all(
    tests.map(async (test) => [test, await readFile(test, "utf8")]),
  ),
);

const functionalManifest = new Set();
for (const source of testSources.values()) {
  for (const route of manifestRoutes(source)) {
    functionalManifest.add(route);
  }
}

const missingDedicated = [];
const missingFunctional = [];

for (const route of routes) {
  const directory = path.dirname(route);
  const dedicatedCandidates = [
    path.join(directory, "route.test.ts"),
    path.join(directory, "route.spec.ts"),
  ];
  const dedicated = [];
  for (const candidate of dedicatedCandidates) {
    if (await exists(candidate)) dedicated.push(candidate);
  }

  const normalized = normalizeRoute(route);
  if (dedicated.length === 0) {
    missingDedicated.push(normalized);
  }

  const hasDedicatedSuccess = dedicated.some((test) =>
    SUCCESS_STATUS_PATTERN.test(testSources.get(test) ?? ""),
  );
  if (!hasDedicatedSuccess && !functionalManifest.has(normalized)) {
    missingFunctional.push(normalized);
  }
}

missingDedicated.sort();
missingFunctional.sort();

const unexpectedDedicated = missingDedicated.filter(
  (route) => !baseline.has(route),
);
const resolvedBaseline = [...baseline].filter(
  (route) => !missingDedicated.includes(route),
);
const routeSet = new Set(routes.map(normalizeRoute));
const staleManifest = [...functionalManifest]
  .filter((route) => !routeSet.has(route))
  .sort();

if (
  unexpectedDedicated.length > 0 ||
  resolvedBaseline.length > 0 ||
  missingFunctional.length > 0 ||
  staleManifest.length > 0
) {
  if (unexpectedDedicated.length > 0) {
    console.error("Rotas novas sem teste dedicado:");
    for (const route of unexpectedDedicated) console.error(`- ${route}`);
  }
  if (resolvedBaseline.length > 0) {
    console.error("Remova do baseline as rotas que agora possuem teste:");
    for (const route of resolvedBaseline) console.error(`- ${route}`);
  }
  if (missingFunctional.length > 0) {
    console.error("Rotas sem cenario funcional 2xx:");
    for (const route of missingFunctional) console.error(`- ${route}`);
  }
  if (staleManifest.length > 0) {
    console.error("Entradas funcionais apontam para rotas removidas:");
    for (const route of staleManifest) console.error(`- ${route}`);
  }
  process.exit(1);
}

const dedicatedCovered = routes.length - missingDedicated.length;
const functionalCovered = routes.length - missingFunctional.length;
console.log(
  `OK: ${dedicatedCovered}/${routes.length} rotas com teste dedicado; ` +
    `${functionalCovered}/${routes.length} com cenario funcional 2xx; ` +
    `${missingDedicated.length} debitos legados.`,
);
