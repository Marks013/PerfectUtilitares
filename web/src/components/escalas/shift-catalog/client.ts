class CatalogRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const CATALOG_REQUEST_TIMEOUT_MS = 15_000;

async function bounded<T>(signal: AbortSignal | null | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new DOMException("A consulta demorou além do esperado. Tente novamente.", "TimeoutError")), CATALOG_REQUEST_TIMEOUT_MS);
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(combined.reason); combined.addEventListener("abort", onAbort, { once: true }); });
  try { combined.throwIfAborted(); return await Promise.race([operation(combined), cancelled]); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); }
}

async function readJson<T>(response: Response, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const body: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("escalas:unlock-required"));
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message : "Não foi possível concluir a solicitação. Confira os dados e tente novamente.";
    throw new CatalogRequestError(response.status, response.status === 409 ? message + " Atualize a revisão e confira novamente." : message);
  }
  if (!body || typeof body !== "object") throw new CatalogRequestError(response.status, "O servidor não confirmou a operação. Atualize e confira o resultado.");
  return body as T;
}

export async function catalogRequest<T>(url: string, init?: RequestInit): Promise<T> {
  return bounded(init?.signal, async signal => readJson<T>(await fetch(url, { cache: "no-store", ...init, signal }), signal));
}

export async function catalogBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  return bounded(signal, async current => {
    const response = await fetch(url, { cache: "no-store", signal: current });
    current.throwIfAborted();
    if (!response.ok) { await readJson<unknown>(response, current); throw new Error("O arquivo não foi confirmado."); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    current.throwIfAborted();
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/plain" || !bytes.length) throw new Error("O servidor não retornou um TXT válido e preenchido. Confira novamente antes de baixar.");
    return bytes;
  });
}

export function catalogPost<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return catalogRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

export function catalogError(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir. Confira a conexão e tente novamente.";
}
