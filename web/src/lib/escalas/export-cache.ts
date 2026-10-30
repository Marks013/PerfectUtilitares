import { EscalaError } from "./access";

type CacheOptions = { maxBytes: number; maxEntries: number; ttlMs: number; concurrency: number };
type Entry = { bytes: Uint8Array; expiresAt: number };
const defaults: CacheOptions = { maxBytes: 16 * 1024 * 1024, maxEntries: 16, ttlMs: 120_000, concurrency: 2 };

/** Process-local, bounded cache. Callers must authorize the requested revision before every lookup. */
export function createEscalaExportCache(options: Partial<CacheOptions> = {}) {
  const limits = { ...defaults, ...options };
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Uint8Array>>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes.byteLength; entries.delete(key); }
  };
  return {
    async get(key: string, generate: () => Promise<Uint8Array> | Uint8Array): Promise<Uint8Array> {
      const now = Date.now();
      for (const [name, entry] of entries) if (entry.expiresAt <= now) remove(name);
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key); entries.set(key, hit);
        return hit.bytes;
      }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      if (pending.size >= limits.concurrency) {
        throw new EscalaError(429, "ESCALA_EXPORT_BUSY", "Outros arquivos estão sendo preparados. Aguarde alguns segundos e tente gerar novamente; sua escala foi preservada.");
      }
      const operation = Promise.resolve().then(generate).then(content => {
        // Own the cached bytes; response construction makes a separate copy for each download.
        const owned = Uint8Array.from(content);
        if (owned.byteLength <= limits.maxBytes) {
          while (entries.size >= limits.maxEntries || bytes + owned.byteLength > limits.maxBytes) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            remove(oldest);
          }
          entries.set(key, { bytes: owned, expiresAt: Date.now() + limits.ttlMs });
          bytes += owned.byteLength;
        }
        return owned;
      }).finally(() => { pending.delete(key); });
      pending.set(key, operation);
      return operation;
    },
  };
}

export const escalaExportCache = createEscalaExportCache();
