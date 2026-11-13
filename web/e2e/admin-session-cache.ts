import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { z } from "zod";

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const lifetimeMs = 60 * 60_000;
const sessions = new Map<string, { savedAt: number; cookies: Cookies }>();
const sessionCookie = z.object({
  name: z.string().regex(/^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/), value: z.string().min(1),
  domain: z.string().min(1), path: z.literal("/"), expires: z.number().finite(),
  httpOnly: z.literal(true), secure: z.boolean(), sameSite: z.enum(["Strict", "Lax", "None"]),
});
const cachedSession = z.strictObject({ savedAt: z.number().finite(), cookies: z.array(sessionCookie).min(1) });

// Only Linux CI persists across worker restarts. Keep secrets outside test-results/playwright-report/repository artifacts.
function directory(key: string): string | undefined {
  if (!process.env.CI || process.platform !== "linux") return undefined;
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid administrative session cache identity.");
  const folder = join(tmpdir(), `perfect-e2e-admin-${key}`);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("Administrative session cache directory is not private.");
  }
  return folder;
}

function fresh(session: { savedAt: number; cookies: Cookies }): boolean {
  const now = Date.now();
  return session.savedAt <= now && now - session.savedAt < lifetimeMs
    && session.cookies.every(cookie => cookie.expires === -1 || cookie.expires * 1000 > now);
}

export function loadAdminCookies(key: string): Cookies | undefined {
  const memory = sessions.get(key);
  if (memory && fresh(memory)) return memory.cookies;
  const folder = directory(key);
  if (!folder) return undefined;
  let fd: number;
  try { fd = openSync(join(folder, "session.json"), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) {
      throw new Error("Administrative session cache file is not private or exceeds its bound.");
    }
    let value: unknown;
    try { value = JSON.parse(readFileSync(fd, "utf8")); }
    catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
    const parsed = cachedSession.safeParse(value);
    if (!parsed.success || !fresh(parsed.data)) return undefined;
    sessions.set(key, parsed.data);
    return parsed.data.cookies;
  } finally { closeSync(fd); }
}

export function storeAdminCookies(key: string, cookies: Cookies): void {
  const selected = cookies.filter(cookie => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(cookie.name));
  const session = cachedSession.parse({ savedAt: Date.now(), cookies: selected });
  sessions.set(key, session);
  const folder = directory(key);
  if (!folder) return;
  const temporary = join(folder, `session-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(folder, "session.json"));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function discardAdminCookies(key: string): void {
  sessions.delete(key);
  const folder = directory(key);
  if (!folder) return;
  try { unlinkSync(join(folder, "session.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
