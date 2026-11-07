import { PgBoss } from "pg-boss";

const state = globalThis as unknown as { workQueuePromise?: Promise<PgBoss> };

async function startWorkQueue() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("WORK_QUEUE_NOT_CONFIGURED");
  const boss = new PgBoss({
    connectionString,
    application_name: "perfect-utilitares-jobs",
    useListenNotify: true,
    createSchema: false,
  });
  // Database driver errors can include connection or payload details.
  boss.on("error", () => console.error(JSON.stringify({ event: "work_queue_error" })));
  try {
    await boss.start();
    return boss;
  } catch {
    await boss.stop({ graceful: true, timeout: 5_000 }).catch(() => undefined);
    throw new Error("WORK_QUEUE_UNAVAILABLE");
  }
}

export function getWorkQueue() {
  state.workQueuePromise ??= startWorkQueue().catch((error) => {
    state.workQueuePromise = undefined;
    throw error;
  });
  return state.workQueuePromise;
}

export async function stopWorkQueue() {
  const pending = state.workQueuePromise;
  state.workQueuePromise = undefined;
  const boss = await pending?.catch(() => null);
  await boss?.stop({ graceful: true, timeout: 30_000 });
}
