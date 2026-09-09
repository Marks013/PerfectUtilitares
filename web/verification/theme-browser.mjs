import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { Client } from "pg";
import { hash } from "bcryptjs";

const production = process.argv.includes("--production");
const baseURL = production ? "https://perfectutilitares.duckdns.org" : "http://127.0.0.1:3017";
const container = `perfect-css-a14-${Date.now()}`;
const password = randomBytes(24).toString("hex");
let server, browser, database, created = false;
let diagnostics = "";
function run(command, args, env = process.env) {
  try { return execFileSync(command, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 }); }
  catch { throw new Error(`${command} failed; sensitive command arguments omitted`); }
}
try {
  if (!production) {
    const image = run("docker", ["inspect", "web-db-1", "--format", "{{.Config.Image}}"]).trim();
    const network = Object.keys(JSON.parse(run("docker", ["inspect", "web-app-1"]))[0].NetworkSettings.Networks)[0];
    run("docker", ["run", "--detach", "--name", container, "--network", network, "--memory=512m", "--cpus=1", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=audit", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=perfect_audit_css", image]);
    created = true;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { run("docker", ["exec", container, "pg_isready", "-U", "audit", "-d", "perfect_audit_css"]); ready = true; break; } catch { await setTimeout(500); }
    }
    assert(ready, "Disposable database did not start");
    const address = JSON.parse(run("docker", ["inspect", container]))[0].NetworkSettings.Networks[network].IPAddress;
    const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: `postgresql://audit:${password}@${address}:5432/perfect_audit_css`, AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_URL: baseURL, APP_URL: baseURL, NEXTAUTH_URL: baseURL, AUTH_TRUST_HOST: "true", NEXT_DIST_DIR: ".next-audit-css" };
    run("npx", ["prisma", "migrate", "deploy"], env);
    database = new Client({ connectionString: env.DATABASE_URL });
    await database.connect();
    await database.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$2,$3,NOW())', ["audit-css-tenant", "Auditoria CSS", "audit-css"]);
    await database.query('INSERT INTO "User" (id,"tenantId",email,name,"passwordHash",role,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())', ["audit-css-admin", "audit-css-tenant", "audit-css@example.invalid", "Auditoria CSS", await hash(password, 12), "ADMIN", "ACTIVE"]);
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3017"], { env, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-12000); });
    ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(baseURL + "/login")).ok) { ready = true; break; } } catch {}
      assert(server.exitCode === null, "Preview exited");
      await setTimeout(500);
    }
    assert(ready, "Preview did not start");
  }
  browser = await chromium.launch({ headless: true });
  const anonymous = await browser.newPage();
  const authenticated = production ? null : await browser.newPage();
  const errors = [];
  for (const page of [anonymous, authenticated].filter(Boolean)) page.on("pageerror", (error) => errors.push(error.message.slice(0, 180)));
  if (authenticated) {
    await authenticated.goto(baseURL + "/login", { waitUntil: "networkidle" });
    await authenticated.getByLabel("E-mail", { exact: true }).fill("audit-css@example.invalid");
    await authenticated.getByLabel("Senha", { exact: true }).fill(password);
    await authenticated.locator('button[type="submit"]').click();
    await authenticated.waitForURL("**/dashboard");
    assert((await (await authenticated.request.get(baseURL + "/api/auth/session")).json()).user?.id, "Isolated login failed");
    console.log("Isolated login validated; inspecting layouts");
  }
  mkdirSync("verification/artifacts", { recursive: true });
  const routes = ["/login", "/dashboard", "/fotos", "/pdf", "/jornada/validar"];
  if (!production) routes.push("/jornada/historico", "/jornada/regras", "/jornada/codigos", "/admin/usuarios", "/conta");
  const cases = [];
  for (const width of [375, 1024, 1440]) {
    for (const theme of ["dark", "light"]) {
      for (const route of routes) {
        const page = route === "/login" || production ? anonymous : authenticated;
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        const response = await page.goto(baseURL + route, { waitUntil: "networkidle" });
        assert(response?.ok(), `HTTP failed: ${route}`);
        assert.equal(new URL(page.url()).pathname, route, `Unexpected redirect: ${route}`);
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => {})));
        });
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, header: document.querySelector("header")?.getBoundingClientRect().height ?? 0 }));
        if (layout.overflow || layout.header >= 120) {
          await page.screenshot({ path: "verification/artifacts/css-layout-failure.png" });
          console.error(JSON.stringify({ route, width, theme, ...layout }));
        }
        assert(!layout.overflow, `Horizontal overflow: ${route}/${width}/${theme}`);
        assert(layout.header < 120, `Oversized header: ${route}`);
        cases.push({ route, width, theme });
        if (cases.length % 10 === 0) console.log(`Layouts validated: ${cases.length}`);
        if (width === 375 && ["/login", "/fotos", "/admin/usuarios"].includes(route)) await page.screenshot({ path: `verification/artifacts/css-${production ? "production" : "preview"}-${route.replaceAll("/", "-")}-${theme}.png` });
      }
    }
  }
  await anonymous.setViewportSize({ width: 375, height: 812 });
  await anonymous.goto(baseURL + "/dashboard", { waitUntil: "networkidle" });
  const menu = anonymous.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  await anonymous.keyboard.press("Escape");
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await anonymous.goto(baseURL + "/login", { waitUntil: "networkidle" });
  await anonymous.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  const button = anonymous.locator('button[type="submit"]');
  await button.hover();
  await anonymous.waitForFunction(() => getComputedStyle(document.querySelector('button[type="submit"]')).backgroundColor === "rgb(17, 94, 89)");
  const background = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.equal(background, "rgb(17, 94, 89)", "Login hover token changed");
  assert.equal(errors.length, 0, `Browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ production, pages: routes.length, cases: cases.length, themes: 2, overflow: 0, browserErrors: errors.length, mobileMenu: true, loginHover: true, isolatedLogin: !production }));
} catch (error) {
  console.error(error.message.replaceAll(password, "[redacted]"));
  const safe = diagnostics.replaceAll(password, "[redacted]").replace(/postgres(?:ql)?:\/\/\S+/g, "[database]").split("\n").filter((line) => /Error:|error TS|Module not found/.test(line)).slice(-4);
  if (safe.length) console.error(safe.join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await database?.end();
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), setTimeout(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (created) { run("docker", ["rm", "--force", container]); console.log("Disposable CSS database removed"); }
}
