import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Worker-local memory only: never serialize administrative sessions to disk.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

export async function loginAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const baseURL = test.info().project.use.baseURL;
  if (!email || !password || !baseURL) {
    throw new Error("Admin credentials and Playwright baseURL are required.");
  }
  const origin = new URL(baseURL).origin;
  const key = `${origin}\n${email}`;
  const cookies = sessions.get(key);
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto(`${origin}/dashboard`);
  } else {
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  }
  await expect(page).toHaveURL(`${origin}/dashboard`, { timeout: 30_000 });
  sessions.set(key, await page.context().cookies(origin));
}
