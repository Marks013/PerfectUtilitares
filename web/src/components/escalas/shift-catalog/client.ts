class CatalogRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function catalogRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => null);
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

export function catalogPost<T>(url: string, body: unknown): Promise<T> {
  return catalogRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function catalogError(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir. Confira a conexão e tente novamente.";
}
