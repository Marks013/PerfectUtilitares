import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const steps = ["quality:code", "test:e2e:isolated"];
const codeChecks = ["prisma:validate", "typecheck", "lint", "test:ops", "test:coverage", "quality:dead-code", "quality:module-size", "quality:route-tests"];
const maxAgeMs = 24 * 60 * 60 * 1000;
const digest = value => createHash("sha256").update(value).digest("hex");
const protectedSource = file => /(^|\/)\.env(?:[./]|$)|\.(pem|key|pfx|p12)$/i.test(file)
  || /^(web\/)?(storage|data|test-results|playwright-report)\//.test(file);

function trackedLinkIdentity(root, file, tracked) {
  const chain = [], seen = new Set();
  let current = path.resolve(root, file);
  const relativePath = absolute => {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative) || protectedSource(relative)) {
      throw new Error("Link de fonte externo ou protegido; quality recusado.");
    }
    return relative;
  };
  for (;;) {
    const relative = relativePath(current);
    if (!tracked.has(relative) || seen.has(relative)) throw new Error("Link de fonte não rastreado ou cíclico; quality recusado.");
    seen.add(relative);
    // Never follow a directory link, including before a later '..' component.
    const parents = relative.split("/").slice(0, -1);
    let parent = root;
    for (const part of parents) {
      parent = path.join(parent, part);
      if (!lstatSync(parent).isDirectory()) throw new Error("Diretório de link de fonte inseguro; quality recusado.");
    }
    const stat = lstatSync(current); // A dangling link is an error, not an omitted deletion.
    if (!stat.isSymbolicLink()) {
      if (!stat.isFile()) throw new Error("Alvo de link de fonte não regular; quality recusado.");
      return ["symlink", chain, relative, stat.mode & 0o111, digest(readFileSync(current))];
    }
    const target = readlinkSync(current);
    chain.push([relative, target]);
    if (path.isAbsolute(target) && !target.startsWith(root + path.sep)) throw new Error("Link de fonte externo; quality recusado.");
    let resolved = path.isAbsolute(target) ? root : path.dirname(current);
    const parts = (path.isAbsolute(target) ? target.slice(root.length + 1) : target).split(path.sep).filter(part => part && part !== ".");
    for (let index = 0; index < parts.length; index++) {
      resolved = parts[index] === ".." ? path.dirname(resolved) : path.join(resolved, parts[index]);
      if (resolved !== root) relativePath(resolved);
      if (index < parts.length - 1 && !lstatSync(resolved).isDirectory()) throw new Error("Diretório de link de fonte inseguro; quality recusado.");
    }
    current = resolved;
  }
}

function execute(command, args, { cwd, env, capture = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Release quality: ${command} falhou.`);
  return capture ? result.stdout.trim() : "";
}

export function qualityProfile(env = process.env, args = []) {
  if (args.length) throw new Error("Quality completo não aceita argumentos adicionais.");
  const forbidden = Object.keys(env).filter(key => {
    if (!env[key] || env[key] === "false" || env[key] === "0") return false;
    return /^(VITEST_|PW_TEST_|PLAYWRIGHT_(GREP|TEST|SHARD|PROJECT)|NODE_OPTIONS$)/i.test(key)
      || /^npm_config_(ignore_scripts|dry_run|if_present|workspace|workspaces|include_workspace_root|global)$/i.test(key)
      || /^(E2E_PRODUCTION|E2E_STANDALONE_DIR|E2E_EXTERNAL_URL)$/i.test(key);
  });
  if (forbidden.length) throw new Error(`Perfil de quality limitado ou externo: ${forbidden.sort().join(", ")}`);
  return {
    mode: "complete-isolated-development-v1",
    privateCsv: Boolean(env.E2E_REAL_CSV_PATH), privateAbsences: Boolean(env.E2E_REAL_ABSENCES_PATH),
    privatePdf: Boolean(env.PDF_REGRESSION_SOURCE), emptyCatalog: env.E2E_EMPTY_TURNO_CATALOG === "1",
    ci: Boolean(env.CI), events: env.EVENTS_ENABLED === "true",
    solverImage: digest(env.E2E_ESCALAS_SOLVER_IMAGE ?? "web-escalas-solver"),
    pdfWorkerImage: digest(env.E2E_PDF_WORKER_IMAGE ?? "native-worker"),
  };
}

export function sourceSnapshot(cwd = process.cwd(), env = process.env, run = execute) {
  const scripts = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).scripts;
  if (scripts.quality !== "node scripts/release-quality.mjs"
    || scripts["quality:code"] !== codeChecks.map(name => `npm run ${name}`).join(" && ")
    || scripts["test:e2e:isolated"] !== "node scripts/run-isolated-e2e.mjs"
    || scripts["test:coverage"] !== "vitest run --coverage") {
    throw new Error("Definição canônica de quality alterada ou filtrada; revise o gate antes do release.");
  }
  const root = path.resolve(run("git", ["rev-parse", "--show-toplevel"], { cwd, env, capture: true }));
  const names = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, env, capture: true });
  const tracked = new Set(run("git", ["ls-files", "--cached", "-z"], { cwd: root, env, capture: true }).split("\0").filter(Boolean));
  const files = [...new Set([...names.split("\0").filter(Boolean),
    ...["AGENTS.md"].filter(file => existsSync(path.join(root, file)))])].sort();
  const hash = createHash("sha256");
  let count = 0;
  for (const file of files) {
    // Never read environment files, keys or persistent runtime payloads.
    if (protectedSource(file)) continue;
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) throw new Error("Caminho de fonte inválido.");
    let stat;
    try { stat = lstatSync(absolute); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify([file, ...trackedLinkIdentity(root, file, tracked)]));
      count++;
      continue;
    }
    if (!stat.isFile()) throw new Error("Fonte contém entrada não regular; quality recusado.");
    hash.update(JSON.stringify([file, stat.mode & 0o111, digest(readFileSync(absolute))]));
    count++;
  }
  const profile = qualityProfile(env);
  const npm = run("npm", ["--version"], { cwd, env, capture: true });
  const installedLock = path.join(cwd, "node_modules", ".package-lock.json");
  return { contentHash: hash.digest("hex"), fileCount: count,
    runtimeHash: digest(JSON.stringify({ node: process.versions, platform: process.platform, arch: process.arch, npm,
      installedLock: existsSync(installedLock) ? digest(readFileSync(installedLock)) : null, profile })), profile };
}

function receiptPath(cwd, env, run) {
  return path.join(run("git", ["rev-parse", "--absolute-git-dir"], { cwd, env, capture: true }), "release-quality.json");
}

export function assertReleaseQuality({ cwd = process.cwd(), env = process.env, run = execute, now = Date.now } = {}) {
  const receipt = JSON.parse(readFileSync(receiptPath(cwd, env, run), "utf8"));
  const snapshot = sourceSnapshot(cwd, env, run);
  if (receipt.version !== 1 || receipt.status !== "PASSED"
    || !Number.isFinite(receipt.completedAt) || receipt.completedAt > now() || now() - receipt.completedAt > maxAgeMs
    || JSON.stringify(receipt.steps) !== JSON.stringify(steps.map(name => ({ name, exit: 0 })))
    || JSON.stringify(receipt.snapshot) !== JSON.stringify(snapshot)) {
    throw new Error("Quality completo ausente, expirado ou incompatível com a fonte/runtime atual. Execute npm run quality antes do release.");
  }
  return snapshot;
}

export function runReleaseQuality({ cwd = process.cwd(), env = process.env, run = execute, now = Date.now, args = [] } = {}) {
  const file = receiptPath(cwd, env, run);
  rmSync(file, { force: true }); // A failed or filtered rerun never leaves an old approval.
  qualityProfile(env, args);
  const before = sourceSnapshot(cwd, env, run);
  const completed = [];
  for (const name of steps) {
    run("npm", ["run", name], { cwd, env });
    completed.push({ name, exit: 0 });
  }
  const after = sourceSnapshot(cwd, env, run);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Fonte/runtime mudou durante o quality; nenhum comprovante emitido.");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, status: "PASSED", completedAt: now(), steps: completed, snapshot: after }) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  console.log("Quality completo aprovado; comprovante local vinculado à fonte/runtime, válido por 24 horas.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runReleaseQuality({ args: process.argv.slice(2) }); }
  catch (error) { console.error(error instanceof Error ? error.message : "Release quality falhou."); process.exitCode = 1; }
}
