import { jsonError } from "@/lib/api/security";
import { boundedRequestBody, RequestBodyReadError } from "@/lib/api/bounded-body";

export async function readMultipartBody(request: Request, maxBytes: number) {
  let bounded: ReturnType<typeof boundedRequestBody> | undefined;
  try {
    if (!request.body) return { ok: false as const, response: jsonError(400, "EMPTY_BODY", "Envie os arquivos do formulário.") };
    bounded = boundedRequestBody(request.body, maxBytes);
    const data = await new Response(bounded.stream, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    return { ok: true as const, data };
  } catch (error) {
    if (error instanceof RequestBodyReadError && error.code === "REQUEST_TIMEOUT") {
      return { ok: false as const, response: jsonError(408, error.code, "O envio demorou mais que o permitido. Confira sua conexão e envie os arquivos novamente.") };
    }
    return { ok: false as const, response: error instanceof RequestBodyReadError && error.code === "PAYLOAD_TOO_LARGE"
      ? jsonError(413, "PAYLOAD_TOO_LARGE", "Os arquivos enviados ultrapassam o limite desta operação.")
      : jsonError(400, "INVALID_MULTIPART", "Não foi possível ler o formulário enviado.") };
  } finally {
    bounded?.cancel();
  }
}
