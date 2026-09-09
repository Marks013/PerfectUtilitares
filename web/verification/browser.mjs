import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseURL = "http://127.0.0.1:3017";
if (!process.env.DATABASE_URL?.includes("/perfect_audit")) throw new Error("Disposable audit database required");
const env = { ...process.env, NODE_ENV: "development", NEXT_DIST_DIR: ".next-audit-preview", AUTH_URL: baseURL, APP_URL: baseURL, NEXTAUTH_URL: baseURL, AUTH_TRUST_HOST: "true" };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3017"], { env, stdio: ["ignore", "pipe", "pipe"] });
let browser;
let diagnostics = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-12000); });
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { const response = await fetch(baseURL + "/login"); if (response.ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error("Preview exited before startup");
    await setTimeout(500);
  }
  assert(ready, "Preview did not start");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  mkdirSync("verification/artifacts", { recursive: true });
  const results = [];
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    for (const route of ["/login", "/dashboard", "/fotos", "/pdf", "/jornada/validar"]) {
      await page.goto(baseURL + route, { waitUntil: "networkidle" });
      const measurements = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        header: document.querySelector("header")?.getBoundingClientRect().height ?? 0,
        email: document.querySelector('input[name="email"]')?.getBoundingClientRect().top,
      }));
      assert(!measurements.overflow, `${route} overflows at ${width}px`);
      if (width === 1440 && route !== "/login") assert(!(await page.getByRole("button", { name: "Menu", exact: true }).isVisible()), "Mobile menu visible on desktop");
      if (width === 375) {
        assert(measurements.header < 120, `${route} header too tall`);
        if (route === "/login") assert(measurements.email < 500, "Login form below mobile fold");
      }
      results.push({ route, width, ...measurements });
      if (["/login", "/dashboard", "/fotos"].includes(route)) await page.screenshot({ path: `verification/artifacts/${route.slice(1)}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(baseURL + "/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  assert(await page.getByRole("navigation", { name: "Navegação principal" }).isVisible());
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Fotos 3x4" }).click();
  await page.waitForURL("**/fotos");
  assert.equal(await page.getByRole("button", { name: "Menu", exact: true }).getAttribute("aria-expanded"), "false");
  await page.goto(baseURL + "/login", { waitUntil: "networkidle" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  const colors = await page.locator('button[type="submit"]').evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, text: style.color };
  });
  const luminance = (rgb) => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (Math.max(luminance(colors.background), luminance(colors.text)) + 0.05) / (Math.min(luminance(colors.background), luminance(colors.text)) + 0.05);
  assert(contrast >= 4.5, "Login button contrast below AA");
  await page.getByLabel("E-mail", { exact: true }).fill("audit@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("Changed-Password-2026");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  const before = await (await page.request.get(baseURL + "/api/auth/session")).json();
  assert(before.user?.id, "Real Auth.js login failed");
  const updated = await page.request.patch(baseURL + "/api/account", { headers: { origin: baseURL }, data: { currentPassword: "Changed-Password-2026", newPassword: "Browser-Password-2026" } });
  assert.equal(updated.status(), 200);
  const after = await (await page.request.get(baseURL + "/api/auth/session")).json();
  assert(!after?.user, "Password change did not revoke actual Auth.js JWT");
  await page.goto(baseURL + "/mediapipe/face-detection-frame.html", { waitUntil: "networkidle" });
  const portrait = await fetch("https://storage.googleapis.com/mediapipe-assets/portrait.jpg");
  assert(portrait.ok, "Reference portrait unavailable");
  const portraitBytes = Array.from(new Uint8Array(await portrait.arrayBuffer()));
  const face = await page.evaluate(async (bytes) => {
    const file = new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Face detection timeout")), 30000);
      window.addEventListener("message", (event) => {
        if (event.data?.type === "photo-3x4:face-detection-result" && event.data.requestId === "audit") {
          clearTimeout(timeout); resolve(event.data);
        }
      });
      window.postMessage({ type: "photo-3x4:detect-face", requestId: "audit", file }, location.origin);
    });
  }, portraitBytes);
  assert(face.ok && face.result.detections.length > 0, "Tasks Vision did not detect reference face: " + (face.error ?? "no detection"));
  const box = face.result.detections[0].boundingBox;
  assert(box.xCenter > 0 && box.xCenter < 1 && box.yCenter > 0 && box.yCenter < 1 && box.width > 0 && box.width <= 1, "Normalized crop contract changed");
  console.log(JSON.stringify({ layouts: results, loginContrast: Number(contrast.toFixed(2)), realLoginAndRevocation: true, facesDetected: face.result.detections.length }));
} catch (error) {
  console.error(error.message);
  const safe = diagnostics.replace(/postgres(?:ql)?:\/\/\S+/g, "[database]").split("\n").filter((line) => /Error:|error TS|Module not found/.test(line)).slice(-6);
  if (safe.length) console.error(safe.join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), setTimeout(5000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
