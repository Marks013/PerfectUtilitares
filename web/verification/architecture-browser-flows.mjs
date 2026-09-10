import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import sharp from "sharp";
import JSZip from "jszip";

export async function exerciseProductionPhoto(page, baseURL) {
  assert.equal(baseURL, "https://perfectutilitares.duckdns.org");
  await page.goto(baseURL + "/fotos", { waitUntil: "networkidle" });
  const buffer = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#e2e8f0" },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "architecture-smoke.png",
      mimeType: "image/png",
      buffer,
    });
  await page
    .getByRole("button", { name: "Recorte manual", exact: true })
    .click();
  await expect(page.locator(".reactEasyCrop_CropArea")).toBeVisible();
  const result = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "Baixar foto atual", exact: true })
      .click(),
  );
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 364);
  assert.equal(metadata.height, 482);
  const repeated = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "Baixar foto novamente", exact: true })
      .click(),
  );
  assert(result.equals(repeated));
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  console.log(
    "Production manual crop and repeated synthetic JPEG download passed",
  );
}

async function downloadBytes(page, action) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    action(),
  ]);
  const stream = await download.createReadStream();
  assert(stream, "Download unavailable");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function submitAndWait(page, path, method, status, action) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().method() === method,
    ),
    action(),
  ]);
  assert.equal(response.status(), status, method + " " + path + " failed");
  console.log(method + " " + path + ": HTTP " + status);
  // The UI consumes no DELETE body; verify removal through the UI and database.
  return method === "DELETE" ? undefined : response.json();
}

export async function exerciseArchitectureFlows(page, database, baseURL) {
  assert.equal(
    new URL(baseURL).hostname,
    "127.0.0.1",
    "Synthetic writes require isolated preview",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!process.argv.includes("--users-only")) {
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      window.architectureObjectUrls = new Set();
      URL.createObjectURL = (value) => {
        const url = create(value);
        window.architectureObjectUrls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        window.architectureObjectUrls.delete(url);
        revoke(url);
      };
    });
    await page.goto(baseURL + "/fotos", { waitUntil: "networkidle" });
    const png = await sharp({
      create: { width: 600, height: 800, channels: 3, background: "#e2e8f0" },
    })
      .png()
      .toBuffer();
    const file = (name) => ({ name, mimeType: "image/png", buffer: png });
    const upload = page.locator('input[type="file"]');
    await upload.setInputFiles([file("first.png"), file("second.png")]);
    await expect(
      page.getByText("2 fotos selecionadas", { exact: true }),
    ).toBeVisible();
    const contrast = page.getByRole("slider", { name: /Contraste/ });
    await contrast.focus();
    await contrast.press("End");
    await expect(contrast).toHaveValue("3");
    await page
      .getByRole("button", { name: "Próxima foto", exact: true })
      .click();
    await expect(contrast).toHaveValue("1");
    await page
      .getByRole("button", { name: "Foto anterior", exact: true })
      .click();
    await expect(contrast).toHaveValue("3");
    await page
      .getByRole("button", { name: "Resetar foto atual", exact: true })
      .click();
    await expect(contrast).toHaveValue("1");
    await upload.setInputFiles(file("first.png"));
    await expect(
      page.getByText("2 fotos selecionadas", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Recorte manual", exact: true })
      .click();
    await expect(page.locator(".reactEasyCrop_CropArea")).toBeVisible();
    const image = await downloadBytes(page, () =>
      page
        .getByRole("button", { name: "Baixar foto atual", exact: true })
        .click(),
    );
    const metadata = await sharp(image).metadata();
    // The existing processor adds the default 5px border outside the 354x472 photo.
    assert.equal(metadata.width, 364);
    assert.equal(metadata.height, 482);
    assert.equal(metadata.format, "jpeg");
    await expect(
      page.getByRole("button", { name: "Baixar foto novamente", exact: true }),
    ).toBeVisible();
    const repeated = await downloadBytes(page, () =>
      page
        .getByRole("button", { name: "Baixar foto novamente", exact: true })
        .click(),
    );
    assert(image.equals(repeated), "Repeated download changed");
    await contrast.focus();
    await contrast.press("ArrowRight");
    await expect(
      page.getByRole("button", { name: "Baixar foto novamente", exact: true }),
    ).toHaveCount(0);
    const zip = await downloadBytes(page, () =>
      page.getByRole("button", { name: "Baixar ZIP", exact: true }).click(),
    );
    assert.equal(zip.subarray(0, 2).toString(), "PK");
    const archive = await JSZip.loadAsync(zip, { checkCRC32: true });
    const entries = Object.values(archive.files).filter((entry) => !entry.dir);
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      const photo = await sharp(await entry.async("nodebuffer")).metadata();
      assert.equal(photo.width, 364);
      assert.equal(photo.height, 482);
    }
    await page
      .getByRole("button", { name: "Auto detectar rosto", exact: true })
      .click();
    await expect(
      page.getByText(/Nenhum rosto foi detectado nesta foto/),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Auto detectar lote", exact: true })
      .click();
    await expect(
      page.getByText(/Auto-detecção em lote concluída: 0\/2/),
    ).toBeVisible({ timeout: 40000 });
    await page.getByRole("button", { name: "Limpar", exact: true }).click();
    await expect(
      page.getByText("Selecionar fotos", { exact: true }),
    ).toBeVisible();
    await page.waitForFunction(() => window.architectureObjectUrls.size === 0);
    const border = page.getByLabel("Adicionar borda", { exact: true });
    await border.uncheck();
    await page.reload({ waitUntil: "networkidle" });
    await expect(border).not.toBeChecked();
    console.log(
      "Photos: selection, replacement, per-file edits, manual crop, JPEG, ZIP, no-face handling, preferences and URL cleanup passed",
    );
  }

  await page.goto(baseURL + "/admin/usuarios", { waitUntil: "networkidle" });
  const row = page
    .getByRole("row")
    .filter({ hasText: "architecture-user@example.invalid" });
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  const edit = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Editar usuário", exact: true }),
    });
  await edit.getByLabel("Nome", { exact: true }).fill("Synthetic Edited");
  await edit.locator('select[name="status"]').selectOption("BLOCKED");
  await submitAndWait(
    page,
    "/api/admin/users/architecture-user",
    "PATCH",
    200,
    () =>
      edit
        .getByRole("button", { name: "Salvar alterações", exact: true })
        .click(),
  );
  await expect(
    edit.getByText("Usuário atualizado.", { exact: true }),
  ).toBeVisible();
  const saved = (
    await database.query('SELECT name,status FROM "User" WHERE id=$1', [
      "architecture-user",
    ])
  ).rows[0];
  assert.deepEqual(saved, { name: "Synthetic Edited", status: "BLOCKED" });
  const tenants = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Empresas", exact: true }),
    });
  await tenants.getByLabel("Nome", { exact: true }).fill("Synthetic Company");
  await tenants.getByLabel("Nome", { exact: true }).press("Tab");
  await expect(
    tenants.getByLabel("Apelido curto", { exact: true }),
  ).toHaveValue("synthetic-company");
  await tenants
    .getByLabel("Apelido curto", { exact: true })
    .fill("architecture-company");
  await tenants.getByLabel("Apelido curto", { exact: true }).press("Tab");
  await expect(
    tenants.getByLabel("Apelido curto", { exact: true }),
  ).toHaveValue("architecture-company");
  const company = await submitAndWait(
    page,
    "/api/admin/tenants",
    "POST",
    201,
    () =>
      tenants
        .getByRole("button", { name: "Criar empresa", exact: true })
        .click(),
  );
  assert.equal(company.slug, "architecture-company");
  await expect(
    tenants.getByText("architecture-company", { exact: true }),
  ).toBeVisible();
  const invitation = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Convidar usuário", exact: true }),
    });
  await invitation
    .getByLabel("Nome", { exact: true })
    .fill("Synthetic Invitation");
  await invitation
    .getByLabel("E-mail", { exact: true })
    .fill("architecture-invite@example.invalid");
  await submitAndWait(page, "/api/admin/invitations", "POST", 201, () =>
    invitation
      .getByRole("button", { name: "Gerar convite", exact: true })
      .click(),
  );
  await expect(
    invitation.getByText(
      "Convite criado para architecture-invite@example.invalid.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await invitation
    .getByRole("button", { name: "Copiar link", exact: true })
    .click();
  await expect(
    invitation.getByRole("button", { name: "Copiado", exact: true }),
  ).toBeVisible();
  console.log("Invitation clipboard write confirmed");
  const count = (
    await database.query(
      'SELECT COUNT(*)::int AS count FROM "UserInvitation" WHERE email=$1',
      ["architecture-invite@example.invalid"],
    )
  ).rows[0].count;
  assert.equal(count, 1);
  await invitation
    .getByLabel("Nome", { exact: true })
    .fill("Existing Synthetic");
  await invitation
    .getByLabel("E-mail", { exact: true })
    .fill("architecture-user@example.invalid");
  await submitAndWait(page, "/api/admin/invitations", "POST", 409, () =>
    invitation
      .getByRole("button", { name: "Gerar convite", exact: true })
      .click(),
  );
  await expect(
    invitation.getByText(/Este e-mail já está cadastrado/),
  ).toBeVisible();
  await row.getByRole("button", { name: "Excluir", exact: true }).click();
  await submitAndWait(
    page,
    "/api/admin/users/architecture-user",
    "DELETE",
    200,
    () =>
      page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Excluir", exact: true })
        .click(),
  );
  await expect(row).toHaveCount(0);
  console.log("Deleted user removed from UI; checking database");
  assert.equal(
    (
      await database.query(
        'SELECT COUNT(*)::int AS count FROM "User" WHERE id=$1',
        ["architecture-user"],
      )
    ).rows[0].count,
    0,
  );
  console.log(
    "Users: editing, status, company, invitation, clipboard, conflict and confirmed deletion passed on synthetic data",
  );
}
