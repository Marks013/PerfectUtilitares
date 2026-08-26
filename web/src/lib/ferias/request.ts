import { createHash } from "node:crypto";
import { choicesSchema } from "@/lib/ferias/contracts";
import { FeriasError } from "@/lib/ferias/errors";
import { assertFeriasActive } from "@/lib/ferias/processing";

export const FERIAS_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FERIAS_MAX_BODY_BYTES = FERIAS_MAX_FILE_BYTES + 512 * 1024;

async function readBoundedBody(request: Request, signal: AbortSignal) {
  if (!request.body) throw new FeriasError("FERIAS_FILE_REQUIRED", "Selecione a planilha de férias.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    assertFeriasActive(signal);
    while (true) {
      const result = await reader.read();
      assertFeriasActive(signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > FERIAS_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FeriasError("FERIAS_UPLOAD_TOO_LARGE", "Envie uma planilha de até 5 MB.", 413);
      }
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export async function readFeriasRequest(request: Request, signal: AbortSignal, exporting: boolean) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new FeriasError("FERIAS_CONTENT_TYPE", "Envie a planilha pelo campo de arquivos.", 415);
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > FERIAS_MAX_BODY_BYTES)) {
    throw new FeriasError("FERIAS_UPLOAD_TOO_LARGE", "Envie uma planilha de até 5 MB.", 413);
  }
  const bytes = await readBoundedBody(request, signal);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new FeriasError("FERIAS_FORM_INVALID", "Não foi possível ler o envio. Selecione a planilha novamente.");
  }
  assertFeriasActive(signal);
  const allowed = new Set(exporting ? ["file", "choices", "revision"] : ["file", "choices"]);
  for (const key of form.keys()) {
    if (!allowed.has(key) || form.getAll(key).length !== 1) {
      throw new FeriasError("FERIAS_FORM_INVALID", "O envio contém campos inválidos ou repetidos.");
    }
  }
  const file = form.get("file");
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size === 0) {
    throw new FeriasError("FERIAS_FILE_INVALID", "Selecione uma planilha XLSX válida.");
  }
  if (file.size > FERIAS_MAX_FILE_BYTES) {
    throw new FeriasError("FERIAS_UPLOAD_TOO_LARGE", "Envie uma planilha de até 5 MB.", 413);
  }
  const rawChoices = form.get("choices") ?? "[]";
  if (typeof rawChoices !== "string" || rawChoices.length > 256 * 1024) {
    throw new FeriasError("FERIAS_CHOICES_INVALID", "Revise as identificações selecionadas.");
  }
  let choices: ReturnType<typeof choicesSchema.parse>;
  try {
    choices = choicesSchema.parse(JSON.parse(rawChoices));
  } catch {
    throw new FeriasError("FERIAS_CHOICES_INVALID", "Revise as identificações selecionadas.");
  }
  if (new Set(choices.map((choice) => choice.row)).size !== choices.length) {
    throw new FeriasError("FERIAS_CHOICES_INVALID", "Há identificações repetidas para a mesma linha.");
  }
  const revision = form.get("revision");
  if (exporting && (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))) {
    throw new FeriasError("FERIAS_REVISION_INVALID", "Analise a planilha antes de baixar o resultado.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  assertFeriasActive(signal);
  return { buffer, choices, revision, fileHash: createHash("sha256").update(buffer).digest("hex") };
}
