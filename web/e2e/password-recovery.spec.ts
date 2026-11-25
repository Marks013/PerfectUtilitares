import { expect, test } from "@playwright/test";

test("password recovery announces validation and retry feedback on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let attempts = 0;
  await page.route("**/api/password-reset/request", async (route) => {
    attempts += 1;
    await route.fulfill(attempts === 1
      ? { status: 429, json: { error: { code: "RATE_LIMITED" } } }
      : { status: 200, json: { ok: true } });
  });

  await page.goto("/esqueci-senha");
  const form = page.getByRole("form", { name: "Recuperar senha" });
  const email = form.getByRole("textbox", { name: "E-mail" });
  const send = form.getByRole("button", { name: "Enviar link" });
  expect((await send.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator("html").evaluate((root) => root.scrollWidth)).toBeLessThanOrEqual(390);
  await send.click();
  await expect(email).toHaveAccessibleDescription("Informe o e-mail cadastrado.");
  await expect(email).toBeFocused();
  expect(attempts).toBe(0);

  await email.fill("usuario@example.test");
  await send.click();
  await expect(form.getByRole("alert")).toHaveText(/Muitas tentativas/);
  await expect(form.getByRole("status")).toHaveCount(0);

  await send.click();
  await expect(form.getByRole("status")).toHaveText(/Se o e-mail estiver cadastrado/);
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("theme control stays usable when writing preferences is blocked", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("app-theme", "light");
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked by the browser", "SecurityError");
    };
  });

  await page.goto("/esqueci-senha");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Ativar tema claro" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
