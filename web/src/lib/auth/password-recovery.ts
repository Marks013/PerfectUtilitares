import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { getWorkQueue } from "@/lib/jobs/queue";

export const PASSWORD_RECOVERY_QUEUE = "perfect-password-recovery";
export const PASSWORD_RECOVERY_TTL_MS = 60 * 60_000;
const queueReady = new WeakMap<PgBoss, Promise<void>>();
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const recoveryRequestSchema = z.strictObject({
  version: z.literal(1),
  requestId: z.uuid(),
  userId: id.nullable(),
  tenantId: id.nullable(),
  securityVersion: z.number().int().nonnegative().nullable(),
  resetStamp: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  issuedAt: timestamp,
  expiresAt: timestamp,
  baseUrl: z.url().max(2048),
  from: z.string().min(3).max(320).regex(/^[^\r\n]+$/),
}).refine((value) => value.expiresAt - value.issuedAt === PASSWORD_RECOVERY_TTL_MS)
  .refine((value) => value.userId === null
    ? value.tenantId === null && value.securityVersion === null && value.resetStamp === null
    : value.tenantId !== null && value.securityVersion !== null && value.resetStamp !== null);

export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;
export type RecoveryConfiguration = { baseUrl: string; from: string };

export function getRecoveryConfiguration(): RecoveryConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const configuredUrl = process.env.APP_URL?.trim() || process.env.AUTH_URL?.trim();
  if (!apiKey || !from || !configuredUrl || from.length > 320 || /[\r\n]/.test(from)) return null;
  const mailbox = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!z.email().safeParse(mailbox).success) return null;
  try {
    const url = new URL(configuredUrl);
    if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return { baseUrl: url.origin, from };
  } catch { return null; }
}

export async function ensurePasswordRecoveryQueue(boss: PgBoss) {
  let ready = queueReady.get(boss);
  if (!ready) {
    ready = (async () => {
      if (!(await boss.getQueue(PASSWORD_RECOVERY_QUEUE))) {
        await boss.createQueue(PASSWORD_RECOVERY_QUEUE, {
          expireInSeconds: 120,
          retentionSeconds: 60 * 60,
          deleteAfterSeconds: 60 * 60,
          retryLimit: 3,
          retryBackoff: true,
          retryDelay: 10,
          retryDelayMax: 60,
          notify: true,
        });
      }
    })().catch((error) => { queueReady.delete(boss); throw error; });
    queueReady.set(boss, ready);
  }
  await ready;
}

export async function enqueuePasswordRecovery(input: Omit<RecoveryRequest, "version" | "requestId" | "issuedAt" | "expiresAt">) {
  const issuedAt = Date.now();
  const data = recoveryRequestSchema.parse({
    ...input, version: 1, requestId: randomUUID(), issuedAt,
    expiresAt: issuedAt + PASSWORD_RECOVERY_TTL_MS,
  });
  const boss = await getWorkQueue();
  await ensurePasswordRecoveryQueue(boss);
  const sent = await boss.send(PASSWORD_RECOVERY_QUEUE, data, {
    id: data.requestId,
    singletonKey: data.requestId,
    singletonSeconds: 60 * 60,
  });
  if (!sent) throw new Error("PASSWORD_RECOVERY_QUEUE_UNAVAILABLE");
}
