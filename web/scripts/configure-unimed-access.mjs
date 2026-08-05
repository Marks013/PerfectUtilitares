import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";

const target =
  process.env.UNIMED_ACCESS_ENV_FILE ??
  "/home/ubuntu/perfectutilitares-config/unimed/access.env";
const temporary = `${target}.${process.pid}.tmp`;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r/g, "").split("\n");
}

try {
  const [standardPassword, adminPassword] = await readStdin();

  for (const password of [standardPassword, adminPassword]) {
    if (!password || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      throw new Error("Cada senha deve ter ao menos 8 caracteres e no máximo 72 bytes.");
    }
  }
  if (standardPassword === adminPassword) {
    throw new Error("As senhas dos perfis devem ser diferentes.");
  }

  const [standardHash, adminHash] = await Promise.all([
    bcrypt.hash(standardPassword, 12),
    bcrypt.hash(adminPassword, 12),
  ]);
  const cookieSecret = randomBytes(48).toString("base64url");
  const contents = [
    `UNIMED_ACCESS_STANDARD_PASSWORD_HASH=${standardHash}`,
    `UNIMED_ACCESS_ADMIN_PASSWORD_HASH=${adminHash}`,
    `UNIMED_ACCESS_COOKIE_SECRET=${cookieSecret}`,
    "UNIMED_ACCESS_SESSION_TTL_MINUTES=480",
    "",
  ].join("\n");

  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  console.log(`Acesso Unimed configurado em ${target}.`);
} catch (error) {
  await rm(temporary, { force: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Falha ao configurar acesso.");
  process.exitCode = 1;
}
