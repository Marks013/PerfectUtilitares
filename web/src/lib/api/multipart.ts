import { jsonError } from "@/lib/api/security";

export async function readMultipartBody(request: Request, maxBytes: number) {
  let received = 0;
  let exceeded = false;
  try {
    if (!request.body) return { ok: false as const, response: jsonError(400, "EMPTY_BODY", "Envie os arquivos do formulário.") };
    const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          exceeded = true;
          controller.error(new Error("MULTIPART_LIMIT"));
          return;
        }
        controller.enqueue(chunk);
      },
    }));
    const data = await new Response(bounded, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    return { ok: true as const, data };
  } catch {
    return { ok: false as const, response: exceeded
      ? jsonError(413, "PAYLOAD_TOO_LARGE", "Os arquivos enviados ultrapassam o limite desta operação.")
      : jsonError(400, "INVALID_MULTIPART", "Não foi possível ler o formulário enviado.") };
  }
}
