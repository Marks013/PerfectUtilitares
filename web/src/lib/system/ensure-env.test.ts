import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scripts/ensure-env.mjs", () => {
  it("preserves SMTP, comments, custom keys and is idempotent", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "perfect-env-"));
    const envPath = path.join(directory, ".env");
    const scriptPath = path.resolve("scripts/ensure-env.mjs");
    const content = [
      "# configuração operacional preservada",
      'POSTGRES_USER="postgres"',
      'POSTGRES_PASSWORD="senha-segura"',
      'POSTGRES_DB="perfectutilitares"',
      'DATABASE_URL="postgresql://postgres:senha-segura@localhost:5432/perfectutilitares?schema=public"',
      'AUTH_SECRET="segredo-seguro"',
      'ADMIN_PASSWORD="senha-admin-segura"',
      'SMTP_USER="usuario@example.com"',
      'SMTP_PASSWORD="senha-smtp"',
      'SMTP_FROM_EMAIL="usuario@example.com"',
      'CUSTOM_OPERATION_FLAG="preservar"',
      "",
    ].join("\n");

    await writeFile(envPath, content);
    await writeFile(path.join(directory, ".env.example"), content);

    const childEnv = { ...process.env };
    for (const key of [
      "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL", "CUSTOM_OPERATION_FLAG",
    ]) {
      delete childEnv[key];
    }

    const run = () =>
      spawnSync(process.execPath, [scriptPath], {
        cwd: directory,
        env: childEnv,
        encoding: "utf8",
      });

    const first = run();
    expect(first.status, first.stderr).toBe(0);

    const afterFirst = await readFile(envPath, "utf8");
    expect(afterFirst).toContain("# configuração operacional preservada");
    expect(afterFirst).toContain('SMTP_USER="usuario@example.com"');
    expect(afterFirst).toContain('SMTP_PASSWORD="senha-smtp"');
    expect(afterFirst).toContain('SMTP_FROM_EMAIL="usuario@example.com"');
    expect(afterFirst).toContain('CUSTOM_OPERATION_FLAG="preservar"');

    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(await readFile(envPath, "utf8")).toBe(afterFirst);
  });
});
