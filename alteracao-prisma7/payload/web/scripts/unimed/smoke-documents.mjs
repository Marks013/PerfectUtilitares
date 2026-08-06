import { writeFile } from "node:fs/promises";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createPrismaAdapter } from "../../src/lib/prisma-adapter.ts";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
const baseUrl = process.env.UNIMED_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const outputPath = process.env.UNIMED_SMOKE_DOCUMENT_OUTPUT;
const namesPath = process.env.UNIMED_SMOKE_NAMES_OUTPUT;
const inactiveOutputPath = process.env.UNIMED_SMOKE_INACTIVE_OUTPUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readCredentials() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const [operatorName, password] = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r/g, "")
    .split("\n");
  assert(
    operatorName && password,
    "Nome do operador e senha administrativa são obrigatórios via stdin.",
  );
  return { operatorName, password };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queueAndDownload(cookie, holderId, reasonCode) {
  const queued = await fetch(`${baseUrl}/api/unimed/documents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: baseUrl,
    },
    body: JSON.stringify({
      beneficiaryId: holderId,
      reasonCode,
      confirmed: true,
    }),
  });
  assert(
    queued.status === 202,
    `Documento ${reasonCode} retornou ${queued.status}.`,
  );
  const { job } = await queued.json();
  assert(job?.id, `Documento ${reasonCode} não criou uma fila.`);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await fetch(`${baseUrl}/api/unimed/documents/${job.id}`, {
      headers: { cookie },
    });
    if (result.status === 202) {
      await sleep(1_000);
      continue;
    }
    if (result.status !== 200) {
      throw new Error(
        `Documento ${reasonCode} retornou ${result.status}: ${await result.text()}`,
      );
    }
    assert(
      result.headers.get("content-type")?.includes("application/pdf"),
      `Documento ${reasonCode} sem PDF.`,
    );
    const bytes = Buffer.from(await result.arrayBuffer());
    assert(bytes.length > 100, `Documento ${reasonCode} gerou PDF vazio.`);
    return bytes;
  }
  throw new Error(`Documento ${reasonCode} não concluiu a conversão no prazo.`);
}

try {
  const credentials = await readCredentials();
  const candidates = await prisma.unimedBeneficiary.findMany({
    where: { category: "HOLDER", competency: { status: "ACTIVE" } },
    select: {
      id: true,
      cpf: true,
      dependents: {
        select: { fullName: true, cpf: true },
        orderBy: { fullName: "asc" },
      },
    },
    take: 2_000,
  });
  const holder = candidates.find(
    (candidate) =>
      candidate.cpf &&
      candidate.dependents.length >= 5 &&
      candidate.dependents.length <= 6 &&
      candidate.dependents.every((dependent) => dependent.cpf),
  );
  assert(
    holder,
    "Nenhum titular ativo com 5 ou 6 dependentes e CPFs foi localizado.",
  );

  const login = await fetch(`${baseUrl}/api/unimed/access/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(credentials),
  });
  assert(
    login.status === 200,
    `Login administrativo retornou ${login.status}.`,
  );
  const setCookies = login.headers.getSetCookie?.() ?? [
    login.headers.get("set-cookie"),
  ];
  const cookie = setCookies
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  assert(cookie, "Cookie administrativo não foi criado.");

  const bytes = await queueAndDownload(cookie, holder.id, 2);
  const inactiveBytes = await queueAndDownload(cookie, holder.id, 8);

  if (outputPath) await writeFile(outputPath, bytes, { mode: 0o600 });
  if (inactiveOutputPath)
    await writeFile(inactiveOutputPath, inactiveBytes, { mode: 0o600 });
  if (namesPath) {
    await writeFile(
      namesPath,
      JSON.stringify(holder.dependents.map((dependent) => dependent.fullName)),
      { mode: 0o600 },
    );
  }

  await fetch(`${baseUrl}/api/unimed/access/session`, {
    method: "DELETE",
    headers: { cookie, origin: baseUrl },
  });
  console.log(
    JSON.stringify({
      document: "RN561",
      dependents: holder.dependents.length,
      bytes: bytes.length,
      inactiveBytes: inactiveBytes.length,
      output: outputPath ?? null,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
