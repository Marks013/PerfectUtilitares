import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const container = `perfect-audit-${Date.now()}`;
const password = randomBytes(24).toString("hex");
function run(command, args, env = process.env) {
  try { return execFileSync(command, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) {
    // Never include command arguments or a connection URL in diagnostics.
    const output = String(error.stdout ?? "") + String(error.stderr ?? "");
    console.error(output.replaceAll(password, "[redacted]").replace(/postgres(?:ql)?:\/\/\S+/g, "[database]"));
    throw new Error(`${command} failed`);
  }
}
try {
  const image = run("docker", ["inspect", "web-db-1", "--format", "{{.Config.Image}}"]).trim();
  const network = Object.keys(JSON.parse(run("docker", ["inspect", "web-app-1"]))[0].NetworkSettings.Networks)[0];
  run("docker", ["run", "--detach", "--name", container, "--network", network, "--memory=768m", "--cpus=1", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=audit", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=perfect_audit", image]);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { run("docker", ["exec", container, "pg_isready", "-U", "audit", "-d", "perfect_audit"]); ready = true; break; } catch { await setTimeout(500); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL not ready");
  const address = JSON.parse(run("docker", ["inspect", container]))[0].NetworkSettings.Networks[network].IPAddress;
  const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: `postgresql://audit:${password}@${address}:5432/perfect_audit`, AUTH_SECRET: randomBytes(32).toString("hex"), APP_URL: "https://audit.invalid", AUTH_URL: "https://audit.invalid", RESEND_API_KEY: "audit-placeholder", RESEND_FROM_EMAIL: "audit@example.invalid" };
  run("npx", ["prisma", "generate"], env);
  run("npx", ["prisma", "migrate", "deploy"], env);
  console.log("Disposable PostgreSQL: all migrations applied");
  console.log(run("npx", ["vitest", "run", "--config", "verification/vitest.config.ts"], env));
  console.log(run("node", ["ops/provision-runtime-database.mjs", "--verify"], env));
  if (process.argv.includes("--browser")) console.log(run("node", ["verification/browser.mjs"], env));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { run("docker", ["rm", "--force", container]); console.log("Disposable PostgreSQL removed"); } catch { process.exitCode = 1; }
}
