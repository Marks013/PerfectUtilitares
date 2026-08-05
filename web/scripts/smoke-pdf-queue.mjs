import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PDF_SMOKE_BASE_URL ?? "http://127.0.0.1:3002";
const inputPath = process.argv[2];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function responseCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie"),
  ];
  return values
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function json(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${response.status}: ${body.error?.code ?? body.error?.message ?? "HTTP error"}`,
    );
  }
  return body;
}

let jobId;
let cookie;

try {
  assert(inputPath, "Informe um PDF para o smoke test.");
  const input = await readFile(inputPath);
  assert(
    input.subarray(0, 5).toString("ascii") === "%PDF-",
    "Arquivo de entrada não é PDF.",
  );

  const createResponse = await fetch(`${baseUrl}/api/pdf/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({
      operation: "COMPRESS",
      options: { quality: "BALANCED" },
    }),
  });
  const created = await json(createResponse);
  jobId = created.job.id;
  cookie = responseCookies(createResponse);
  assert(cookie, "Sessão anônima PDF não foi criada.");

  const uploadResponse = await fetch(`${baseUrl}/api/pdf/jobs/${jobId}/files`, {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "content-length": String(input.length),
      cookie,
      origin: baseUrl,
      "x-file-name": encodeURIComponent(path.basename(inputPath)),
    },
    body: input,
  });
  await json(uploadResponse);

  const queueResponses = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetch(`${baseUrl}/api/pdf/jobs/${jobId}/queue`, {
        method: "POST",
        headers: { cookie, origin: baseUrl },
      }),
    ),
  );
  const queueStatuses = queueResponses.map((response) => response.status);
  assert(
    queueStatuses.every((status) => status === 200 || status === 202),
    `Fila concorrente retornou ${queueStatuses.join(",")}.`,
  );

  let current;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/pdf/jobs/${jobId}`, {
      headers: { cookie },
    });
    current = (await json(response)).job;
    if (["SUCCEEDED", "FAILED"].includes(current.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert(
    current?.status === "SUCCEEDED",
    `Job terminou em ${current?.status ?? "timeout"}${
      current?.errorCode ? ` (${current.errorCode})` : ""
    }.`,
  );
  const output = current.artifacts?.find(
    (artifact) => artifact.kind === "OUTPUT",
  );
  assert(output && Number(output.sizeBytes) > 0, "Artefato de saída ausente.");

  const download = await fetch(
    `${baseUrl}/api/pdf/jobs/${jobId}/outputs/${output.id}`,
    { headers: { cookie } },
  );
  assert(download.status === 200, `Download retornou ${download.status}.`);
  const result = Buffer.from(await download.arrayBuffer());
  assert(
    result.subarray(0, 5).toString("ascii") === "%PDF-",
    "Saída não é PDF.",
  );
  assert(
    result.length === Number(output.sizeBytes),
    "Tamanho baixado diverge do artefato.",
  );

  console.log(
    JSON.stringify({
      concurrentQueueStatuses: queueStatuses,
      finalStatus: current.status,
      inputBytes: input.length,
      outputBytes: result.length,
      outputArtifacts: current.artifacts.filter(
        (artifact) => artifact.kind === "OUTPUT",
      ).length,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (jobId && cookie) {
    await fetch(`${baseUrl}/api/pdf/jobs/${jobId}`, {
      method: "DELETE",
      headers: { cookie, origin: baseUrl },
    }).catch(() => undefined);
  }
}
