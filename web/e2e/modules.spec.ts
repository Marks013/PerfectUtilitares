import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const enabled = process.env.E2E_MUTATION === "1";
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const mailCaptureUrl = process.env.E2E_RESEND_CAPTURE_URL;
const unimedAdminPassword = process.env.E2E_UNIMED_ADMIN_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(adminEmail!);
  await page.locator('input[name="password"]').fill(adminPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
}

test.beforeEach(() => {
  test.skip(!enabled, "Module E2E runs only against an isolated database");
  test.skip(!adminEmail || !adminPassword, "Admin credentials are required");
});

test("presence event customization, private invitation and report work together", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  const origin = new URL(page.url()).origin;
  const startsAt = new Date(Date.now() + 30 * 86_400_000);
  const deadline = new Date(Date.now() + 20 * 86_400_000);
  const reminderAt = new Date(Date.now() + 15 * 86_400_000);
  const retentionUntil = new Date(Date.now() + 210 * 86_400_000);
  const slug = `evento-e2e-${Date.now()}`;

  const created = await page.request.post("/api/admin/presencas", {
    headers: { origin },
    data: {
      eventSlug: slug,
      title: "Celebração E2E",
      startsAt: startsAt.toISOString(),
      confirmationDeadline: deadline.toISOString(),
      status: "DRAFT",
    },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();

  const guestCreated = await page.request.post(
    `/api/admin/presencas/${event.id}/convidados`,
    {
      headers: { origin },
      data: {
        name: "Convidada E2E",
        email: "convidada@example.test",
        guestSlug: "convidada-e2e",
        companionLimit: 2,
      },
    },
  );
  expect(guestCreated.status()).toBe(201);
  const guest = await guestCreated.json();
  expect(guest.invitationUrl).toContain(
    `/presenca/${slug}/convidada-e2e#c_`,
  );
  expect(guest.shortUrl).toMatch(/\/p\/p_[A-Za-z0-9_-]{16}$/);
  expect(new URL(guest.shortUrl).origin).toBe(origin);

  const categoryCreated = await page.request.post(
    `/api/admin/presencas/${event.id}/categorias-presentes`,
    {
      headers: { origin },
      data: { name: "Cozinha", emoji: "🍳" },
    },
  );
  expect(categoryCreated.status()).toBe(201);
  const category = await categoryCreated.json();

  const markedGift = await page.request.post(
    `/api/admin/presencas/${event.id}/presentes`,
    {
      headers: { origin },
      data: {
        title: "Jogo de panelas",
        emoji: "🍲",
        reservedManually: true,
      },
    },
  );
  expect(markedGift.status()).toBe(201);
  const markedGiftData = await markedGift.json();
  const movedGift = await page.request.patch(
    `/api/admin/presencas/${event.id}/presentes/${markedGiftData.id}`,
    {
      headers: { origin },
      data: { categoryId: category.id },
    },
  );
  expect(movedGift.status()).toBe(200);
  expect((await movedGift.json()).categoryId).toBe(category.id);

  const linkedGift = await page.request.post(
    `/api/admin/presencas/${event.id}/presentes`,
    {
      headers: { origin },
      data: {
        title: "Liquidificador",
        emoji: "🥤",
        categoryId: category.id,
        reservedByGuestId: guest.id,
      },
    },
  );
  expect(linkedGift.status()).toBe(201);

  const configured = await page.request.patch(
    `/api/admin/presencas/${event.id}`,
    {
      headers: { origin },
      data: {
        status: "PUBLISHED",
        theme: {
          preset: "GARDEN",
          cover: "WEDDING",
          accent: "GREEN",
          welcomeTitle: "Vamos celebrar juntos",
        },
        reminderAt: reminderAt.toISOString(),
        retentionUntil: retentionUntil.toISOString(),
      },
    },
  );
  expect(configured.status()).toBe(200);

  const report = await page.request.get(
    `/api/admin/presencas/${event.id}/relatorio?status=ALL`,
  );
  expect(report.status()).toBe(200);
  expect(report.headers()["content-type"]).toContain("text/csv");
  expect(await report.text()).toContain("Convidada E2E");

  await page.goto(guest.shortUrl);
  await expect(page.getByRole("heading", { name: "Celebração E2E" })).toBeVisible();
  await expect(page.getByText("Vamos celebrar juntos")).toBeVisible();
  await expect(page.getByText("Olá, Convidada E2E.")).toBeVisible();
  await expect(page.locator("header img")).toHaveAttribute(
    "src",
    /wedding\.webp/,
  );
  await expect(page.getByRole("heading", { name: "Cozinha" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jogo de panelas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escolhido" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Liberar" })).toBeVisible();
  await expect(page.getByText("Você ainda não respondeu ao convite.")).toBeVisible();

  await page.getByRole("button", { name: "Adicionar adulto" }).click();
  await page
    .getByRole("button", { name: "Confirmar presença", exact: true })
    .click();
  await expect(page.getByText(/Presença confirmada para 1 pessoa/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Presença confirmada" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Desconfirmar presença" }).click();
  await expect(page.getByText("Sua presença está desconfirmada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Presença desconfirmada" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("password reset reaches the isolated email transport", async ({ page }) => {
  test.skip(!mailCaptureUrl, "Isolated email capture is required");
  await page.goto("/login");
  await fetch(mailCaptureUrl!, { method: "DELETE" });
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/password-reset/request", {
    headers: { origin },
    data: { email: adminEmail },
  });
  expect(response.status()).toBe(200);

  await expect
    .poll(async () => {
      const messages = await fetch(mailCaptureUrl!).then((result) => result.json());
      return messages.length;
    })
    .toBe(1);

  const messages = await fetch(mailCaptureUrl!).then((result) => result.json());
  expect(messages[0]).toMatchObject({
    from: "Perfect E2E <no-reply@example.test>",
    to: adminEmail,
  });
  expect(messages[0].html).toContain("/convite/");
});

test("photo endpoint processes real image bytes and dimensions", async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const source = await sharp({
    create: {
      width: 32,
      height: 48,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();

  const response = await page.request.post("/api/fotos/processar", {
    headers: { origin },
    multipart: {
      file: { name: "portrait.png", mimeType: "image/png", buffer: source },
      format: "jpeg",
      quality: "90",
    },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/jpeg");

  const metadata = await sharp(await response.body()).metadata();
  expect(metadata).toMatchObject({ format: "jpeg", width: 354, height: 472 });

  const reprocessed = await page.request.post("/api/fotos/processar", {
    headers: { origin },
    multipart: {
      file: { name: "portrait.png", mimeType: "image/png", buffer: source },
      format: "png",
      quality: "82",
      brightness: "1.1",
      contrast: "0.9",
    },
  });
  expect(reprocessed.status()).toBe(200);
  const reprocessedMetadata = await sharp(await reprocessed.body()).metadata();
  expect(reprocessedMetadata).toMatchObject({
    format: "png",
    width: 354,
    height: 472,
  });

  const batch = await page.request.post("/api/fotos/lote", {
    headers: { origin },
    multipart: {
      files: { name: "portrait-a.png", mimeType: "image/png", buffer: source },
      format: "jpeg",
      quality: "88",
    },
  });
  expect(batch.status()).toBe(200);
  expect(batch.headers()["content-type"]).toBe("application/zip");
  expect((await batch.body()).byteLength).toBeGreaterThan(0);
});

test("Jornada navigation collapses after selecting an option", async ({ page }) => {
  await page.goto("/dashboard");
  const menu = page.locator("details").filter({ hasText: "Validador de Jornada" });

  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await menu.getByRole("link", { name: "Validar", exact: true }).click();

  await expect(page).toHaveURL(/\/jornada\/validar(?:\?|$)/);
  await expect(menu).not.toHaveAttribute("open", "");
});

test("Unimed unlock creates a real session and reads configuration", async ({
  page,
}) => {
  test.skip(!unimedAdminPassword, "Isolated Unimed password is required");
  await page.goto("/unimed/acesso");
  const origin = new URL(page.url()).origin;
  const unlock = await page.request.post("/api/unimed/access/session", {
    headers: { origin },
    data: { password: unimedAdminPassword },
  });
  expect(unlock.status()).toBe(200);

  const configuration = await page.request.get("/api/unimed/configuration");
  expect(configuration.status()).toBe(200);
  await expect(configuration.json()).resolves.toMatchObject({
    ageBrackets: expect.any(Array),
    planPrices: expect.any(Array),
    addonPrices: expect.any(Array),
    reasons: expect.any(Array),
  });

  const navigation = await page.goto("/unimed/configuracoes");
  expect(navigation?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText(
    "Digite a senha do modulo Unimed para continuar",
  );
});

test("PDF merge persists, queues, processes and downloads a valid result", async ({
  page,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const create = await page.request.post("/api/pdf/jobs", {
    headers: { origin },
    data: { operation: "MERGE" },
  });
  expect(create.status()).toBe(201);
  const created = await create.json();
  const jobId = created.job.id;

  try {
    const pages = [];
    for (const [index, label] of ["first", "second"].entries()) {
      const document = await PDFDocument.create();
      document.addPage([320, 240]).drawText(`E2E ${label}`, {
        x: 40,
        y: 180,
      });
      const input = Buffer.from(await document.save());
      const upload = await page.request.post(
        `/api/pdf/jobs/${jobId}/files`,
        {
          headers: {
            origin,
            "content-type": "application/pdf",
            "content-length": String(input.length),
            "x-file-name": encodeURIComponent(`${index + 1}-${label}.pdf`),
          },
          data: input,
        },
      );
      expect(upload.status()).toBe(201);
      const uploaded = await upload.json();
      pages.push({
        id: `page-${index + 1}`,
        artifactId: uploaded.artifactId,
        sourcePage: 1,
        rotation: 0,
      });
    }

    const organized = await page.request.patch(
      `/api/pdf/jobs/${jobId}`,
      {
        headers: { origin },
        data: { manifest: { version: 1, pages }, annotations: [] },
      },
    );
    expect(organized.status()).toBe(200);

    const queued = await page.request.post(`/api/pdf/jobs/${jobId}/queue`, {
      headers: { origin },
    });
    expect([200, 202]).toContain(queued.status());

    let job:
      | {
          status: string;
          artifacts: Array<{ id: string; kind: string }>;
        }
      | undefined;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/pdf/jobs/${jobId}`);
          expect(response.status()).toBe(200);
          job = (await response.json()).job;
          return job?.status;
        },
        { timeout: 90_000, intervals: [250, 500, 1_000] },
      )
      .toBe("SUCCEEDED");

    const output = job?.artifacts.find((artifact) => artifact.kind === "OUTPUT");
    expect(output).toBeTruthy();
    const download = await page.request.get(
      `/api/pdf/jobs/${jobId}/outputs/${output!.id}`,
    );
    expect(download.status()).toBe(200);
    const merged = await PDFDocument.load(await download.body());
    expect(merged.getPageCount()).toBe(2);
  } finally {
    const cleanup = await page.request.delete(`/api/pdf/jobs/${jobId}`, {
      headers: { origin },
    });
    expect(cleanup.status()).toBe(204);
  }
});
