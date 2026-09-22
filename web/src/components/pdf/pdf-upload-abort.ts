export function bindPdfUploadAbort(
  request: XMLHttpRequest,
  signal: AbortSignal | undefined,
  reject: (reason: unknown) => void,
) {
  signal?.throwIfAborted();
  const abort = () => {
    request.abort();
    reject(new DOMException("Envio cancelado.", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  request.addEventListener("loadend", () => {
    signal?.removeEventListener("abort", abort);
  }, { once: true });
}
