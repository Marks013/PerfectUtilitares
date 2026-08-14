import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;
const cwd = process.cwd();
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

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd, detached: true, env, stdio: ["ignore", "pipe", "pipe"],
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

const name = `perfectutilitares_e2e_${process.pid}_${Date.now()}`;
const database = databaseHost();
const adminUrl = databaseUrl("postgres", database);
adminUrl.searchParams.delete("schema");
const testUrl = databaseUrl(name, database);
const temp = await mkdtemp(path.join(os.tmpdir(), "perfectutilitares-e2e-"));
await mkdir(path.join(temp, "pdf-storage"), { recursive: true });
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
const appUrl = `http://127.0.0.1:${port}`;
const databaseAdmin = new Client({ connectionString: adminUrl.toString() });
let app;
let worker;
let created = false;

try {
  await databaseAdmin.connect();
  await databaseAdmin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const [standardHash, adminHash] = await Promise.all([
    bcrypt.hash(standardPassword, 4),
    bcrypt.hash(unimedPassword, 4),
  ]);
  const env = {
    ...process.env,
    NEXT_DIST_DIR: nextDistDir,
    NODE_ENV: "development",
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
    RESEND_API_KEY: "re_e2e_local_only",
    RESEND_FROM_EMAIL: "Perfect E2E <no-reply@example.test>",
    RESEND_API_BASE_URL: mail.baseUrl,
    UNIMED_ACCESS_STANDARD_PASSWORD_HASH: standardHash,
    UNIMED_ACCESS_ADMIN_PASSWORD_HASH: adminHash,
    UNIMED_ACCESS_COOKIE_SECRET: randomBytes(48).toString("base64url"),
    UNIMED_ACCESS_SESSION_TTL_MINUTES: "30",
    PDF_STORAGE_DIR: path.join(temp, "pdf-storage"),
    PDF_WORKER_HEARTBEAT_PATH: path.join(temp, "pdf-worker-heartbeat"),
    SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
  };
  await run("npx", ["prisma", "generate"], env);
  await run("npx", ["prisma", "migrate", "deploy"], env);
  await run("npm", ["run", "prisma:seed"], env);
  app = start("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], env);
  worker = start("npx", ["tsx", "src/workers/pdf-worker.ts"], env);
  await waitForApp(`${appUrl}/login`, app);
  await run("npx", ["playwright", "test", ...process.argv.slice(2)], env);
} catch (error) {
  if (app?.output?.length) console.error(app.output.join("").split(/\r?\n/).slice(-30).join("\n"));
  if (worker?.output?.length) console.error(worker.output.join("").split(/\r?\n/).slice(-30).join("\n"));
  throw error;
} finally {
  await Promise.all([stop(app), stop(worker)]);
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
  await rm(path.join(cwd, nextDistDir), { recursive: true, force: true });
  if ((await readFile(nextEnvPath, "utf8")) !== originalNextEnv) {
    await writeFile(nextEnvPath, originalNextEnv);
  }
  if ((await readFile(tsconfigPath, "utf8")) !== originalTsconfig) {
    await writeFile(tsconfigPath, originalTsconfig);
  }
}
