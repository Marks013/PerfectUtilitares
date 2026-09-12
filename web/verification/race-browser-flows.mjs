import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import sharp from "sharp";

// These tests only operate on the harness's disposable database and preview.
export async function exerciseRaceFlows(page, database, baseURL) {
  assert.equal(new URL(baseURL).hostname, "127.0.0.1");
  assert.equal(
    (await database.query("SELECT current_database() AS name")).rows[0].name,
    "perfect_audit_css",
  );
  const baseline = process.argv.includes("--expect-stale");
  const usersOnly = process.argv.includes("--race-users-only");
  const renamed = await page.request.patch(baseURL + "/api/account", {
    headers: { origin: baseURL },
    data: { name: "Synthetic Renamed Admin" },
  });
  assert.equal(renamed.status(), 200);
  const session = await (
    await page.request.get(baseURL + "/api/auth/session")
  ).json();
  assert.equal(session.user?.id, "audit-css-admin");
  assert.equal(session.user?.name, "Synthetic Renamed Admin");
  console.log(
    "Name-only account PATCH preserves authenticated browser session",
  );
  const findings = [];
  function record(name, stale) {
    findings.push({ name, stale });
    console.log(JSON.stringify({ race: name, stale, expectedStale: baseline }));
  }
  const png = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#e2e8f0" },
  })
    .png()
    .toBuffer();
  async function preparePhoto(batch = false) {
    await page.goto(baseURL + "/fotos", { waitUntil: "networkidle" });
    await page
      .locator('input[type="file"]')
      .setInputFiles(
        (batch ? ["race.png", "race-second.png"] : ["race.png"]).map(
          (name) => ({ name, mimeType: "image/png", buffer: png }),
        ),
      );
    await expect(
      page.getByRole("button", { name: "Baixar foto atual", exact: true }),
    ).toBeEnabled();
  }
  async function holdResponse(path, method, fail = false) {
    let release;
    let ready;
    let finished;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const captured = new Promise((resolve) => {
      ready = resolve;
    });
    const settled = new Promise((resolve) => {
      finished = resolve;
    });
    const handler = async (route) => {
      if (route.request().method() !== method) return route.continue();
      try {
        const response = fail ? null : await route.fetch({ timeout: 30000 });
        if (response) assert.equal(response.status(), 200);
        ready();
        await gate;
        if (fail)
          await route.fulfill({
            status: 422,
            json: { error: { message: "Falha sintética tardia" } },
          });
        else await route.fulfill({ response });
      } finally {
        finished();
      }
    };
    await page.route(baseURL + path, handler);
    return {
      captured: () =>
        Promise.race([
          captured,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Delayed request not captured: " + path)),
              30000,
            );
            timer.unref();
          }),
        ]),
      release: async () => {
        release();
        await settled;
        await page.unroute(baseURL + path, handler);
        await page.waitForTimeout(400);
      },
    };
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const kind of usersOnly ? [] : ["single", "zip"]) {
    for (const action of ["clear", "edit"]) {
      await preparePhoto(kind === "zip");
      const pending = await holdResponse(
        kind === "single" ? "/api/fotos/processar" : "/api/fotos/lote",
        "POST",
      );
      let downloads = 0;
      const listener = () => {
        downloads++;
      };
      page.on("download", listener);
      await page
        .getByRole("button", {
          name: kind === "single" ? "Baixar foto atual" : "Baixar ZIP",
          exact: true,
        })
        .click();
      await pending.captured();
      if (action === "clear")
        await page.getByRole("button", { name: "Limpar", exact: true }).click();
      else {
        const contrast = page.getByRole("slider", { name: /Contraste/ });
        await contrast.focus();
        await contrast.press("End");
        await expect(contrast).toHaveValue("3");
      }
      await pending.release();
      record(
        `photo-${kind}-${action}`,
        downloads > 0 ||
          (await page
            .getByRole("button", { name: /Baixar (foto|ZIP) novamente/ })
            .count()) > 0,
      );
      page.off("download", listener);
    }
  }
  for (const action of baseline
    ? ["switch", "close"]
    : ["switch", "close", "draft", "error-switch"]) {
    await page.goto(baseURL + "/admin/usuarios", { waitUntil: "networkidle" });
    const row = (email) => page.getByRole("row").filter({ hasText: email });
    const edit = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Editar usuário", exact: true }),
    });
    await row("architecture-user@example.invalid")
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    await edit.getByLabel("Nome", { exact: true }).fill("Race " + action);
    const pending = await holdResponse(
      "/api/admin/users/architecture-user",
      "PATCH",
      action === "error-switch",
    );
    await edit
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await pending.captured();
    if (action === "switch" || action === "error-switch") {
      await row("audit-css@example.invalid")
        .getByRole("button", { name: "Editar", exact: true })
        .click();
      await expect(edit.getByLabel("E-mail", { exact: true })).toHaveValue(
        "audit-css@example.invalid",
      );
      if (!baseline)
        await expect(
          edit.getByRole("button", { name: "Salvar alterações", exact: true }),
        ).toBeEnabled();
    } else if (action === "draft") {
      await edit.getByLabel("Nome", { exact: true }).fill("Unsaved draft");
    } else await edit.getByTitle("Fechar edição", { exact: true }).click();
    await pending.release();
    const email = edit.getByLabel("E-mail", { exact: true });
    record(
      "user-" + action,
      action === "close"
        ? (await email.count()) > 0
        : action === "draft"
          ? (await edit.getByLabel("Nome", { exact: true }).inputValue()) !==
            "Unsaved draft"
          : (await email.inputValue()) !== "audit-css@example.invalid" ||
            (await edit.getByText(/Falha/).count()) > 0,
    );
    if (action !== "error-switch")
      assert.equal(
        (
          await database.query('SELECT name FROM "User" WHERE id=$1', [
            "architecture-user",
          ])
        ).rows[0].name,
        "Race " + action,
      );
  }
  // Mock only the isolated MediaPipe frame's transport, never application hooks.
  await page.route("**/mediapipe/face-detection-frame.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>addEventListener('message',e=>{if(e.data.type==='photo-3x4:detect-face')window.request=e.data;});window.release=()=>parent.postMessage({type:'photo-3x4:face-detection-result',requestId:window.request.requestId,ok:true,result:{imageWidth:600,imageHeight:800,detections:[{boundingBox:{originX:200,originY:180,width:160,height:200}}]}},location.origin)</script>`,
    }),
  );
  for (const kind of usersOnly ? [] : ["single", "batch"]) {
    for (const action of ["clear", "reset"]) {
      await preparePhoto(kind === "batch");
      await page
        .getByRole("button", {
          name:
            kind === "single" ? "Auto detectar rosto" : "Auto detectar lote",
          exact: true,
        })
        .click();
      const frameElement = page.locator('iframe[title="Detecção de rosto"]');
      await expect(frameElement).toHaveCount(1);
      const frame = await (await frameElement.elementHandle()).contentFrame();
      await frame.waitForFunction(() => Boolean(window.request));
      await page
        .getByRole("button", {
          name: action === "clear" ? "Limpar" : "Resetar foto atual",
          exact: true,
        })
        .click();
      await frame.evaluate(() => window.release());
      if (baseline && kind === "batch") {
        await expect
          .poll(() =>
            page
              .frames()
              .some(
                (candidate) =>
                  candidate !== frame &&
                  candidate.url().includes("face-detection-frame"),
              ),
          )
          .toBe(true);
        const secondFrame = page
          .frames()
          .find(
            (candidate) =>
              candidate !== frame &&
              candidate.url().includes("face-detection-frame"),
          );
        await secondFrame.waitForFunction(() => Boolean(window.request));
        await secondFrame.evaluate(() => window.release());
      }
      await expect(frameElement).toHaveCount(0);
      await page.waitForTimeout(400);
      record(
        `face-${kind}-${action}`,
        (await page
          .getByText(
            /Rosto detectado\. O recorte|Auto-detecção em lote concluída:/,
          )
          .count()) > 0,
      );
    }
  }
  assert.equal(findings.length, (usersOnly ? 0 : 8) + (baseline ? 2 : 4));
  assert.deepEqual(
    findings.filter((finding) => finding.stale !== baseline),
    [],
    "Race behavior differs from expected mode",
  );
  console.log(
    `Race verification passed: ${findings.length}; mode=${baseline ? "reproduce-before-fix" : "reject-stale-results"}`,
  );
}
