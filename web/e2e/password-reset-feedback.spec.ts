import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("password recovery distinguishes request failures from generic confirmation", async ({
  page,
}) => {
  const endpoint = "**/api/password-reset/request";
  const confirmation = page.getByText("Se o e-mail estiver cadastrado e ativo", {
    exact: false,
  });

  await page.goto("/esqueci-senha");
  await page.getByLabel("E-mail", { exact: true }).fill(`e2e-${randomUUID()}@example.invalid`);
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 429, json: { error: "rate limited" } }),
  );
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Muitas tentativas" })).toBeVisible();
  await expect(confirmation).toHaveCount(0);

  await page.unroute(endpoint);
  const response = page.waitForResponse(
    (result) => result.url().endsWith("/api/password-reset/request") &&
      result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Enviar link" }).click();
  expect((await response).status()).toBe(200);
  await expect(confirmation).toBeVisible();
  await expect(page.getByText("Muitas tentativas", { exact: false })).toHaveCount(0);
});
