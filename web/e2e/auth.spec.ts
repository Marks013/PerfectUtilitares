import { expect, test } from "@playwright/test";

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

test.beforeEach(() => {
  test.skip(!adminEmail || !adminPassword, "Admin credentials are required");
});

test("login, session projection and authenticated navigation", async ({
  page,
}) => {
  await page.goto("/login?callbackUrl=%2Fconta");
  await page.locator('input[name="email"]').fill(adminEmail!);
  await page.locator('input[name="password"]').fill(adminPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/conta(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Credenciais inválidas");

  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (cookie) =>
        cookie.name.includes("authjs.session-token") &&
        cookie.httpOnly &&
        cookie.sameSite === "Lax",
    ),
  ).toBe(true);

  const accountResponse = await page.request.get("/api/account");
  expect(accountResponse.status()).toBe(405);
  expect(accountResponse.headers().allow).toContain("PATCH");
});

test("external callback URL cannot become an open redirect", async ({ page }) => {
  await page.goto(
    "/login?callbackUrl=https%3A%2F%2Fattacker.example%2Fphishing",
  );
  await page.locator('input[name="email"]').fill(adminEmail!);
  await page.locator('input[name="password"]').fill(adminPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  expect(new URL(page.url()).hostname).not.toBe("attacker.example");
});
