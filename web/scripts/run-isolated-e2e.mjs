import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, chown, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";
import { cleanupPhase, listedCases, parseSuiteArguments, phaseEnvironment, selectedPhases, suitePhases } from "./e2e-suite-plan.mjs";
import {
  assertPdfWorkerImageRevision, linkPdfWorkerHeartbeat, pdfWorkerContainerArguments,
  pdfWorkerPreflightArguments, unlinkPdfWorkerHeartbeat,
} from "./e2e-pdf-runtime.mjs";

import { releaseTestDatabase, releaseTestDatabaseUrl, releaseTestPostgresId } from "./release-test-postgres.mjs";

const { Client } = pg;
const cwd = process.cwd();
const suiteArguments = parseSuiteArguments(process.argv.slice(2));
const productionBuild = process.env.E2E_PRODUCTION === "1";
const releasePg = releaseTestPostgresId();
if (!releasePg) dotenv.config({ path: path.join(cwd, ".env"), quiet: true });
if (!releasePg && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pdfWorkerImage = process.env.E2E_PDF_WORKER_IMAGE?.trim();
const sourceRevision = pdfWorkerImage
  ? process.env.SOURCE_REVISION || capture("git", ["rev-parse", "HEAD"]) : undefined;

function capture(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function databaseHost() {
  if (releasePg) return releaseTestDatabase();
  // No GitHub Actions o PostgreSQL é um service container, não um serviço
  // iniciado pelo Docker Compose deste projeto. Nesse ambiente a conexão
  // oficial já é fornecida por DATABASE_URL.
  if (process.env.CI === "true") {
    const url = new URL(process.env.DATABASE_URL);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!url.hostname || !username) {
      throw new Error("CI DATABASE_URL does not contain PostgreSQL host/user.");
    }
    return {
      address: url.hostname,
      username,
      password,
    };
  }

  const id = capture("docker", [
    "ps",
    "--filter",
    "label=com.docker.compose.project=web",
    "--filter",
    "label=com.docker.compose.service=db",
    "--format",
    "{{.ID}}",
  ]).split(/\r?\n/).find(Boolean);
  if (!id) throw new Error("PerfectUtilitares database is not running.");
  const inspect = JSON.parse(capture("docker", ["inspect", id]))[0];
  const networks = Object.values(inspect?.NetworkSettings?.Networks ?? {});
  const address = networks.map((network) => network?.IPAddress).find(Boolean);
  if (!address) throw new Error("Database has no reachable address.");
  const values = Object.fromEntries(
    (inspect?.Config?.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  if (!values.POSTGRES_USER || !values.POSTGRES_PASSWORD) {
    throw new Error("Database container credentials are incomplete.");
  }
  return {
    address,
    username: values.POSTGRES_USER,
    password: values.POSTGRES_PASSWORD,
  };
}

function databaseUrl(name, database) {
  if (releasePg) return releaseTestDatabaseUrl(database, name);
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = database.address;
  url.username = database.username;
  url.password = database.password;
  url.port = url.port || "5432";
  url.pathname = `/${name}`;
  return url;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function startMailServer() {
  const messages = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__messages") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(messages));
      return;
    }
    if (request.method === "DELETE" && request.url === "/__messages") {
      messages.length = 0;
      response.writeHead(204).end();
      return;
    }
    if (request.method === "POST" && request.url === "/emails") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      messages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `e2e-email-${messages.length}` }));
      return;
    }
    response.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start mail server."));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function startSecureProxy(port, directory) {
  const keyPath = path.join(directory, "localhost.key");
  const certificatePath = path.join(directory, "localhost.crt");
  capture("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certificatePath, "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  const server = https.createServer({
    key: await readFile(keyPath), cert: await readFile(certificatePath),
  }, (request, response) => {
    const upstream = http.request({
      hostname: "127.0.0.1", port, path: request.url, method: request.method,
      headers: { ...request.headers, "x-forwarded-proto": "https" },
    }, (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
    });
    upstream.on("error", () => response.writeHead(502).end());
    request.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `https://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}

function start(command, args, env, workingDirectory = cwd) {
  const child = spawn(command, args, {
    cwd: workingDirectory, detached: true, env, stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const collect = (chunk) => {
    output.push(chunk.toString("utf8"));
    if (output.length > 60) output.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  // Keep spawn failures inside the wait/cleanup path instead of an unhandled
  // EventEmitter error terminating the runner before finally can execute.
  child.once("error", (error) => collect(error.message));
  return { child, output };
}

async function stop(current) {
  if (!current?.child?.pid || current.child.exitCode !== null) return;
  try { process.kill(-current.child.pid, "SIGTERM"); } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  await Promise.race([
    new Promise((resolve) => current.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (current.child.exitCode === null) {
    try { process.kill(-current.child.pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([
      new Promise((resolve) => current.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (current.child.exitCode === null && current.child.signalCode === null) throw new Error("Owned E2E process did not stop");
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

async function waitForApp(url, current) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (current.child.exitCode !== null) {
      throw new Error(`App stopped early.\n${current.output.join("")}`);
    }
    try {
      if ((await fetch(url, { redirect: "manual" })).status > 0) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`App readiness timeout.\n${current.output.join("")}`);
}

async function waitForWorker(file, current) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (current.child.exitCode !== null) {
      throw new Error(`PDF worker stopped early.\n${current.output.join("")}`);
    }
    try {
      const heartbeat = JSON.parse(await readFile(file, "utf8"));
      if (typeof heartbeat.pid === "number" &&
          Date.now() - Date.parse(heartbeat.updatedAt) < 30_000) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`PDF worker heartbeat timeout.\n${current.output.join("")}`);
}

// Collect with the same selectors and phase config before allocating resources.
// --list does not run hooks, tests or Playwright's webServer.
const listings = {};
for (const phase of suitePhases) {
  const collectionEnv = { ...process.env, E2E_SUITE_PHASE: phase, E2E_EXTERNAL_URL: "http://127.0.0.1:1" };
  delete collectionEnv.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete collectionEnv.PLAYWRIGHT_JSON_OUTPUT_DIR;
  delete collectionEnv.PLAYWRIGHT_JSON_OUTPUT_NAME;
  // Empty individual phases are valid for a focused selector; the combined
  // collection below must still contain at least one case.
  listings[phase] = listedCases(JSON.parse(capture("npx", ["playwright", "test", ...suiteArguments.args, "--list", "--pass-with-no-tests", "--reporter=json"], collectionEnv)));
}
const phases = selectedPhases(listings);
if (suiteArguments.list) {
  for (const phase of phases) console.log(`[${phase}]\n${listings[phase].join("\n")}`);
} else {
  const runId = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
  for (const phase of phases) await runPhase(phase, runId);
}

async function runPhase(phase, runId) {
const artifactDirectory = path.resolve(cwd, "../outputs/escalas-e2e-harness", runId, phase);
let artifactsCreated = false;
let executionFailed = false;
let executionError;
let cleanupError;
const name = `perfectutilitares_e2e_${phase}_${runId.replaceAll("-", "_")}`;
const database = databaseHost();
const adminUrl = databaseUrl("postgres", database);
adminUrl.searchParams.delete("schema");
const testUrl = databaseUrl(name, database);
let temp;
const standaloneCwd = path.resolve(cwd, process.env.E2E_STANDALONE_DIR || ".next/standalone");
const runtimeCwd = productionBuild ? standaloneCwd : cwd;
const pdfWorkerHeartbeatPath = path.join(
  runtimeCwd,
  "data",
  "pdf-jobs",
  `pdf-worker-heartbeat-${process.pid}-${randomBytes(6).toString("hex")}`,
);
const nextDistDir = `.next-e2e-${phase}-${runId}`;
const nextEnvPath = path.join(cwd, "next-env.d.ts");
let originalNextEnv;
const tsconfigPath = path.join(cwd, "tsconfig.json");
let originalTsconfig;
const adminPassword = randomBytes(24).toString("base64url");
const standardPassword = randomBytes(18).toString("base64url");
const unimedPassword = randomBytes(18).toString("base64url");
let mail;
let secureProxy;
const databaseAdmin = new Client({ connectionString: adminUrl.toString() });
let app;
let worker;
let solverId;
let pdfWorkerId;
let pdfHeartbeatLink;
let created = false;

try {
  await mkdir(artifactDirectory, { recursive: true });
  artifactsCreated = true;
  await writeFile(path.join(artifactDirectory, "selection.json"), JSON.stringify({ phase, cases: listings[phase] }, null, 2));
  temp = await mkdtemp(path.join(os.tmpdir(), `perfectutilitares-e2e-${phase}-`));
  await mkdir(path.join(temp, "pdf-storage"), { recursive: true });
  await mkdir(path.dirname(pdfWorkerHeartbeatPath), { recursive: true });
  originalNextEnv = await readFile(nextEnvPath, "utf8");
  originalTsconfig = await readFile(tsconfigPath, "utf8");
  mail = await startMailServer();
  const port = await freePort();
  const internalUrl = `http://127.0.0.1:${port}`;
  const solverSecretPath = path.join(temp, "solver.secret");
  const solverContainerSecretPath = path.join(temp, "solver-container.secret");
  const recoverySecretPath = path.join(temp, "recovery.secret");
  if (pdfWorkerImage) {
    if (process.platform !== "linux") throw new Error("The container PDF E2E worker requires Linux host networking.");
    const imageRevision = capture("docker", ["image", "inspect", "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}', pdfWorkerImage]);
    assertPdfWorkerImageRevision(imageRevision, sourceRevision);
    capture("docker", pdfWorkerPreflightArguments(pdfWorkerImage));
  }
  // Exercise the real current processor without using or restarting the production solver.
  const solverPort = await freePort();
  const testSolverSecret = randomBytes(32).toString("base64url");
  await writeFile(recoverySecretPath, randomBytes(32).toString("base64url"), { mode: 0o600 });
  await Promise.all([writeFile(solverSecretPath, testSolverSecret, { mode: 0o600 }), writeFile(solverContainerSecretPath, testSolverSecret, { mode: 0o600 })]);
  // Host and container may have different UIDs; both test-only files stay private.
  if (process.getuid?.() === 0) await chown(solverContainerSecretPath, 1001, 1001);
  else if (process.getuid?.() !== 1001) capture("sudo", ["-n", "chown", "1001:1001", solverContainerSecretPath]);
  solverId = capture("docker", ["run", "--detach", "--rm", "--name", name + "-solver",
    "--label", "perfectutilitares.e2e=" + name, "--publish", "127.0.0.1:" + solverPort + ":8080",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "1536m", "--cpus", "1",
    "--user", "1001:1001", "--env", "PYTHONDONTWRITEBYTECODE=1", "--volume", path.join(cwd, "ops", "escalas") + ":/model:ro",
    "--env", "ESCALAS_SOLVER_SECRET_FILE=/run/secrets/escalas_solver_secret",
    "--volume", solverContainerSecretPath + ":/run/secrets/escalas_solver_secret:ro",
    "--workdir", "/model", process.env.E2E_ESCALAS_SOLVER_IMAGE || "web-escalas-solver", "python", "-B", "server.py"]);
  const solverUrl = "http://127.0.0.1:" + solverPort;
  const solverDeadline = Date.now() + 30000;
  let solverReady = false;
  while (Date.now() < solverDeadline) {
    try { if ((await fetch(solverUrl + "/health")).status === 200) { solverReady = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!solverReady) throw new Error("Isolated scheduling processor did not become healthy.");
  // Production module cookies require HTTPS; keep that security behavior intact.
  if (productionBuild) secureProxy = await startSecureProxy(port, temp);
  const appUrl = secureProxy?.baseUrl ?? internalUrl;
  await databaseAdmin.connect();
  await databaseAdmin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const [standardHash, adminHash] = await Promise.all([
    bcrypt.hash(standardPassword, 4),
    bcrypt.hash(unimedPassword, 4),
  ]);
  const composed = phaseEnvironment(process.env, phase, { runId, adminPassword });
  const commonEnv = {
    ...(pdfWorkerImage ? { SOURCE_REVISION: sourceRevision } : {}),
    NEXT_DIST_DIR: productionBuild ? ".next" : nextDistDir,
    NODE_ENV: productionBuild ? "production" : "development",
    DATABASE_URL: testUrl.toString(),
    APP_URL: appUrl,
    AUTH_URL: appUrl,
    AUTH_TRUST_HOST: "true",
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    E2E_EXTERNAL_URL: appUrl,
    E2E_MUTATION: "1",
    // Playwright otherwise stores DOM text on assertion failure, even with trace/screenshot disabled.
    PLAYWRIGHT_NO_COPY_PROMPT: process.env.E2E_REAL_CSV_PATH || process.env.E2E_REAL_ABSENCES_PATH ? "1" : process.env.PLAYWRIGHT_NO_COPY_PROMPT,
    ESCALAS_SOLVER_URL: solverUrl,
    ESCALAS_SOLVER_SECRET_FILE: solverSecretPath,
    E2E_RESEND_CAPTURE_URL: `${mail.baseUrl}/__messages`,
    PASSWORD_RECOVERY_SECRET_FILE: recoverySecretPath,
    E2E_UNIMED_ADMIN_PASSWORD: unimedPassword,
    E2E_UNIMED_STANDARD_PASSWORD: standardPassword,
    RESEND_API_KEY: "re_e2e_local_only",
    RESEND_FROM_EMAIL: "Perfect E2E <no-reply@example.test>",
    RESEND_API_BASE_URL: mail.baseUrl,
    UNIMED_ACCESS_STANDARD_PASSWORD_HASH: standardHash,
    UNIMED_ACCESS_ADMIN_PASSWORD_HASH: adminHash,
    UNIMED_ACCESS_COOKIE_SECRET: randomBytes(48).toString("base64url"),
    UNIMED_ACCESS_SESSION_TTL_MINUTES: "30",
    REAJUSTE_ACCESS_STANDARD_PASSWORD_HASH: standardHash,
    REAJUSTE_ACCESS_COOKIE_SECRET: randomBytes(48).toString("base64url"),
    REAJUSTE_ACCESS_SESSION_TTL_MINUTES: "30",
    PDF_STORAGE_DIR: path.join(temp, "pdf-storage"),
    PDF_WORKER_HEARTBEAT_PATH: pdfWorkerHeartbeatPath,
    SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
  };
  const seedEnv = { ...composed.seed, ...commonEnv };
  const env = { ...composed.runtime, ...commonEnv,
    E2E_ARTIFACT_DIR: artifactDirectory,
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(artifactDirectory, "report.json"),
  };
  // The fixture creates the nominal tenant by API (201). Never seed that slug.
  await run("npx", ["prisma", "generate"], seedEnv);
  await run("npx", ["prisma", "migrate", "deploy"], seedEnv);
  await run("npm", ["run", "prisma:seed"], seedEnv);
  const queueDatabase = new Client({ connectionString: testUrl.toString() });
  try {
    await queueDatabase.connect();
    // Production provisions this schema before the runtime starts (createSchema: false).
    await queueDatabase.query("CREATE SCHEMA IF NOT EXISTS pgboss");
  } finally {
    await queueDatabase.end().catch(() => undefined);
  }
  if (productionBuild) {
    // Match the standalone image layout without changing the production service.
    // The existing build and compiled worker must be supplied by the caller.
    const standalone = standaloneCwd;
    await access(path.join(standalone, "server.js"));
    await access(path.join(cwd, "dist", "pdf-worker.mjs"));
    for (const relative of [
      "public", ".next/static", "dist/ferias-workbook-worker.cjs",
      "dist/unimed-workbook-worker.cjs",
      "node_modules/@img", "node_modules/pdfkit/js/data",
      "node_modules/pdfjs-dist/cmaps", "node_modules/pdfjs-dist/standard_fonts",
      "node_modules/pdfjs-dist/wasm",
    ]) {
      const destination = path.join(standalone, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(cwd, relative), destination, { recursive: true });
    }
    app = start("node", [path.join(standalone, "server.js")], {
      ...env, PORT: String(port), HOSTNAME: "127.0.0.1",
    });
    // Both runtimes resolve the heartbeat relative to their cwd, as in Docker.
    if (!pdfWorkerImage) worker = start("node", [path.join(cwd, "dist", "pdf-worker.mjs")], env, runtimeCwd);
  } else {
    // Direct next dev does not invoke npm's lifecycle hooks. Fresh checkouts need
    // the same generated browser assets and workers as the documented dev command.
    await run("npm", ["run", "predev"], env);
    app = start("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], env);
    if (!pdfWorkerImage) worker = start("npx", ["tsx", "src/workers/pdf-worker.ts"], env);
  }
  if (pdfWorkerImage) {
    pdfHeartbeatLink = await linkPdfWorkerHeartbeat(pdfWorkerHeartbeatPath, path.join(temp, "worker"));
    const workerEnv = {
      ...env, NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "",
      PASSWORD_RECOVERY_SECRET_FILE: "/run/secrets/password_recovery_secret",
    };
    pdfWorkerId = capture("docker", pdfWorkerContainerArguments({
      image: pdfWorkerImage, name: name + "-pdf-worker",
      storageDirectory: env.PDF_STORAGE_DIR, heartbeatDirectory: pdfHeartbeatLink.directory,
      recoverySecretPath,
      uid: process.getuid(), gid: process.getgid(),
    }), workerEnv);
    worker = start("docker", ["start", "--attach", pdfWorkerId], workerEnv);
  }
  await waitForApp(`${internalUrl}/login`, app);
  await waitForWorker(pdfWorkerHeartbeatPath, worker);
  await run("npx", ["playwright", "test", ...suiteArguments.args], env);
} catch (error) {
  executionFailed = true;
  executionError = error;
  if (app?.output?.length) console.error(app.output.join("").split(/\r?\n/).slice(-30).join("\n"));
  if (worker?.output?.length) console.error(worker.output.join("").split(/\r?\n/).slice(-30).join("\n"));
} finally {
  let cleanupFailed = false;
  try {
    await cleanupPhase([
    ["PDF container", async () => {
      if (pdfWorkerId) capture("docker", ["rm", "--force", pdfWorkerId]);
    }],
    ["application", () => stop(app)],
    ["worker", () => stop(worker)],
    ["solver", async () => { if (solverId) capture("docker", ["stop", "--time", "3", solverId]); }],
    ["HTTPS proxy", async () => { await secureProxy?.close(); }],
    ["mail capture", async () => { await mail?.close(); }],
    ["database", async () => {
      if (!created) return;
      await databaseAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
      await databaseAdmin.query(`DROP DATABASE IF EXISTS "${name}"`);
    }],
    ["database connection", () => databaseAdmin.end()],
    ["heartbeat", async () => {
      if (pdfHeartbeatLink) await unlinkPdfWorkerHeartbeat(pdfWorkerHeartbeatPath, pdfHeartbeatLink.target);
      else if (!pdfWorkerImage) await rm(pdfWorkerHeartbeatPath, { force: true });
    }],
    ["temporary directory", async () => { if (temp) await rm(temp, { recursive: true, force: true }); }],
    ["Next output", () => rm(path.join(cwd, nextDistDir), { recursive: true, force: true })],
    ["Next declarations", async () => {
      if (originalNextEnv !== undefined && (await readFile(nextEnvPath, "utf8")) !== originalNextEnv) await writeFile(nextEnvPath, originalNextEnv);
    }],
    ["TypeScript configuration", async () => {
      if (originalTsconfig !== undefined && (await readFile(tsconfigPath, "utf8")) !== originalTsconfig) await writeFile(tsconfigPath, originalTsconfig);
    }],
    ]);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  } finally {
    try {
      if (artifactsCreated) await writeFile(path.join(artifactDirectory, "lifecycle.json"), JSON.stringify({
        phase, executionFailed, cleanupFailed,
      }, null, 2));
    } catch (error) { cleanupError ??= error; }
  }
}
if (executionError && cleanupError) throw new AggregateError([executionError, cleanupError], "E2E execution and cleanup failed");
if (executionError) throw executionError;
if (cleanupError) throw cleanupError;
}
