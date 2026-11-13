import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { discardAdminCookies, loadAdminCookies, storeAdminCookies } from "./admin-session-cache";

// This is a cache identity, not a credential or permission grant. Different runs/users/environments cannot share it.
function cacheIdentity(origin: string, email: string, password: string): string {
  return createHash("sha256").update(JSON.stringify([process.cwd(), process.env.GITHUB_RUN_ID ?? process.ppid,
    process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_SHA, origin, email.trim().toLowerCase(), password, process.env.AUTH_SECRET])).digest("hex");
}

export async function loginAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const baseURL = test.info().project.use.baseURL;
  if (!email || !password || !baseURL) {
    throw new Error("Admin credentials and Playwright baseURL are required.");
  }
  const origin = new URL(baseURL).origin;
  const key = cacheIdentity(origin, email, password);
  const cookies = loadAdminCookies(key);
  if (cookies) {
    await page.context().addCookies(cookies);
    // Revalidate the real JWT against current account/security-stamp state; never infer auth from a cached cookie alone.
    const response = await page.request.get(`${origin}/api/auth/session`);
    if (response.status() >= 500) throw new Error("Cached administrative session validation is unavailable.");
    const session: unknown = response.ok() ? await response.json() : null;
    const user = session && typeof session === "object" && "user" in session ? session.user : null;
    if (user && typeof user === "object" && "email" in user && typeof user.email === "string"
      && user.email.trim().toLowerCase() === email.trim().toLowerCase()
      && "role" in user && user.role === "ADMIN" && "status" in user && user.status === "ACTIVE") {
      await page.goto(`${origin}/dashboard`);
      await expect(page).toHaveURL(`${origin}/dashboard`, { timeout: 30_000 });
      storeAdminCookies(key, await page.context().cookies(origin));
      return;
    }
    discardAdminCookies(key);
    await page.context().clearCookies();
  }
  // A fresh run, expired cache or revoked session must still authenticate through the actual form.
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/dashboard`, { timeout: 30_000 });
  storeAdminCookies(key, await page.context().cookies(origin));
}
