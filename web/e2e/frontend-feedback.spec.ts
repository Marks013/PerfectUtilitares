import { expect, test } from "./fixtures";

test("login identifies invalid fields and preserves entered values", async ({ page }) => {
  await page.goto("/login");
  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  await email.fill("email-invalido");
  await password.fill("valor-sintetico-nao-enviado");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute("aria-describedby", "login-email-error");
  await expect(page.locator("form").getByRole("alert")).toContainText("Confira os campos");
  await expect(password).toHaveValue("valor-sintetico-nao-enviado");
});

test("login focuses a generic server failure without identifying a credential", async ({ page }) => {
  await page.goto("/login?error=credentials");
  await expect(page.locator("form").getByRole("alert")).toBeFocused();
  await expect(page.locator("form").getByRole("alert")).toContainText("E-mail ou senha não conferem");
  await expect(page.locator('input[aria-invalid="true"]')).toHaveCount(0);
});

test("login exposes pending state and keeps one in-flight submission", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/login", async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests += 1;
    await gate;
    await route.continue();
  });
  await page.locator('input[name="email"]').fill("feedback-test@example.test");
  await page.locator('input[name="password"]').fill("synthetic-wrong-password");
  const button = page.getByRole("button", { name: "Entrar", exact: true });
  const before = await button.boundingBox();
  try {
    await button.click();
    const pending = page.getByRole("button", { name: "Entrando…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Verificando");
    await page.keyboard.press("Enter");
    await expect.poll(() => requests).toBe(1);
    const during = await pending.boundingBox();
    expect(during?.width).toBe(before?.width);
    expect(during?.height).toBe(before?.height);
  } finally { release(); }
  await expect(page.locator("form").getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled();
});

test("destructive dialog retains failure, blocks duplicates and retries in a short viewport", async ({ page }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  test.skip(!email || !password, "Isolated admin credentials are required");
  test.setTimeout(90_000);
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Never delete the test account: all DELETE attempts are intercepted.
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    requests += 1;
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Falha sintética. Tente novamente." }) });
  });
  await page.goto("/login?callbackUrl=%2Fconta");
  await page.locator('input[name="email"]').fill(email!);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/conta(?:\?|$)/, { timeout: 30_000 });
  await page.setViewportSize({ width: 375, height: 320 });
  const trigger = page.getByRole("button", { name: "Excluir minha conta", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(320);
  try {
    await dialog.getByRole("button", { name: "Excluir conta", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Excluindo…", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests).toBe(1);
  } finally { release(); }
  await expect(dialog.getByRole("alert")).toContainText("Falha sintética");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await dialog.getByRole("button", { name: "Excluir conta", exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
