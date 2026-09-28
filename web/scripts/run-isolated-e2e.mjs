import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;
const cwd = process.cwd();
const productionBuild = process.env.E2E_PRODUCTION === "1";
dotenv.config({ path: path.join(cwd, ".env"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

function capture(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function databaseHost() {
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
  return { child, output };
}

async function stop(current) {
  if (!current?.child?.pid || current.child.exitCode !== null) return;
  try { process.kill(-current.child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([
    new Promise((resolve) => current.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (current.child.exitCode === null) {
    try { process.kill(-current.child.pid, "SIGKILL"); } catch {}
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

const name = `perfectutilitares_e2e_${process.pid}_${Date.now()}`;
const database = databaseHost();
const adminUrl = databaseUrl("postgres", database);
adminUrl.searchParams.delete("schema");
const testUrl = databaseUrl(name, database);
const temp = await mkdtemp(path.join(os.tmpdir(), "perfectutilitares-e2e-"));
await mkdir(path.join(temp, "pdf-storage"), { recursive: true });
const runtimeCwd = productionBuild ? path.join(cwd, ".next", "standalone") : cwd;
const pdfWorkerHeartbeatPath = path.join(
  runtimeCwd,
  "data",
  "pdf-jobs",
  `pdf-worker-heartbeat-${process.pid}`,
);
await mkdir(path.dirname(pdfWorkerHeartbeatPath), { recursive: true });
const nextDistDir = `.next-e2e-${process.pid}-${Date.now()}`;
const nextEnvPath = path.join(cwd, "next-env.d.ts");
const originalNextEnv = await readFile(nextEnvPath, "utf8");
const tsconfigPath = path.join(cwd, "tsconfig.json");
const originalTsconfig = await readFile(tsconfigPath, "utf8");
const adminPassword = randomBytes(24).toString("base64url");
const standardPassword = randomBytes(18).toString("base64url");
const unimedPassword = randomBytes(18).toString("base64url");
const mail = await startMailServer();
const port = await freePort();
const internalUrl = `http://127.0.0.1:${port}`;
let secureProxy;
const databaseAdmin = new Client({ connectionString: adminUrl.toString() });
let app;
let worker;
let created = false;

try {
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
  const env = {
    ...process.env,
    NEXT_DIST_DIR: productionBuild ? ".next" : nextDistDir,
    NODE_ENV: productionBuild ? "production" : "development",
    DATABASE_URL: testUrl.toString(),
    APP_URL: appUrl,
    AUTH_URL: appUrl,
    AUTH_TRUST_HOST: "true",
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    ADMIN_EMAIL: "e2e-admin@example.test",
    ADMIN_NAME: "E2E Administrator",
    ADMIN_PASSWORD: adminPassword,
    DEFAULT_TENANT_SLUG: "principal",
    E2E_EXTERNAL_URL: appUrl,
    E2E_MUTATION: "1",
    E2E_RESEND_CAPTURE_URL: `${mail.baseUrl}/__messages`,
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
  await run("npx", ["prisma", "generate"], env);
  await run("npx", ["prisma", "migrate", "deploy"], env);
  await run("npm", ["run", "prisma:seed"], env);
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
    const standalone = path.join(cwd, ".next", "standalone");
    await access(path.join(standalone, "server.js"));
    await access(path.join(cwd, "dist", "pdf-worker.mjs"));
    for (const relative of [
      "public", ".next/static", "dist/ferias-workbook-worker.cjs",
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
    worker = start("node", [path.join(cwd, "dist", "pdf-worker.mjs")], env, runtimeCwd);
  } else {
    // Direct next dev does not invoke npm's lifecycle hooks. Fresh checkouts need
    // the same generated browser assets and workers as the documented dev command.
    await run("npm", ["run", "predev"], env);
    app = start("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], env);
    worker = start("npx", ["tsx", "src/workers/pdf-worker.ts"], env);
  }
  await waitForApp(`${internalUrl}/login`, app);
  await waitForWorker(pdfWorkerHeartbeatPath, worker);
  await run("npx", ["playwright", "test", ...process.argv.slice(2)], env);
} catch (error) {
  if (app?.output?.length) console.error(app.output.join("").split(/\r?\n/).slice(-30).join("\n"));
  if (worker?.output?.length) console.error(worker.output.join("").split(/\r?\n/).slice(-30).join("\n"));
  throw error;
} finally {
  await Promise.all([stop(app), stop(worker)]);
  await secureProxy?.close().catch(() => undefined);
  await mail.close().catch(() => undefined);
  if (created) {
    await databaseAdmin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [name],
    );
    await databaseAdmin.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await databaseAdmin.end().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
  await rm(pdfWorkerHeartbeatPath, { force: true });
  await rm(path.join(cwd, nextDistDir), { recursive: true, force: true });
  if ((await readFile(nextEnvPath, "utf8")) !== originalNextEnv) {
    await writeFile(nextEnvPath, originalNextEnv);
  }
  if ((await readFile(tsconfigPath, "utf8")) !== originalTsconfig) {
    await writeFile(tsconfigPath, originalTsconfig);
  }
}
