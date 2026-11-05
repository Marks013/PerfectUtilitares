const IDLE_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 5 * 60_000;

export class RequestBodyReadError extends Error {
  constructor(readonly code: "PAYLOAD_TOO_LARGE" | "REQUEST_TIMEOUT") {
    super(code);
    this.name = "RequestBodyReadError";
  }
}

export function boundedRequestBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let received = 0;
  let closed = false;

  function cancel() {
    if (closed) return;
    closed = true;
    // A source may never resolve cancellation. Do not hold the response hostage.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new RequestBodyReadError("REQUEST_TIMEOUT");
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new RequestBodyReadError("REQUEST_TIMEOUT")), Math.min(IDLE_TIMEOUT_MS, remaining));
          }),
        ]);
        if (closed) return;
        if (chunk.done) {
          closed = true;
          reader.releaseLock();
          controller.close();
          return;
        }
        received += chunk.value.byteLength;
        if (received > maxBytes) throw new RequestBodyReadError("PAYLOAD_TOO_LARGE");
        controller.enqueue(chunk.value);
      } catch (error) {
        cancel();
        controller.error(error);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    cancel,
  });
  return { stream, cancel };
}
