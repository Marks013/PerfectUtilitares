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
