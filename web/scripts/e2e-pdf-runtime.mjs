import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
import path from "node:path";

// Pass only the E2E worker's inputs. Values stay in the child environment, not
// Docker arguments or diagnostic output; production credentials are not mounted.
const workerEnvironment = [
  "NODE_ENV", "DATABASE_URL", "SOURCE_REVISION", "APP_URL",
  "PDF_STORAGE_DIR", "PDF_WORKER_HEARTBEAT_PATH",
  "PDF_WORKER_CONCURRENCY", "PDF_WORKER_AUTHENTICATED_GROUP_CONCURRENCY",
  "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_DSN", "SENTRY_AUTH_TOKEN",
  "PASSWORD_RECOVERY_SECRET_FILE", "RESEND_API_KEY", "RESEND_FROM_EMAIL",
  "RESEND_API_BASE_URL",
];

export function assertPdfWorkerImageRevision(actual, expected) {
  if (!expected || actual !== expected) {
    throw new Error("Build the E2E PDF worker from the current SOURCE_REVISION before running browser tests.");
  }
}

export function pdfWorkerPreflightArguments(image) {
  return [
    "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--memory", "256m", "--cpus", "1", "--pids-limit", "64",
    "--entrypoint", "sh", image, "-ec",
    'for tool in qpdf gs pdftoppm pdftotext python3; do command -v "$tool" >/dev/null; done; ' +
    "test -r /app/jpeg-xobject-resample.py; test -r /app/mono-xobject-resample.py; " +
    'python3 -B -c "import pikepdf; from PIL import Image"',
  ];
}

export function pdfWorkerContainerArguments({ image, name, storageDirectory, heartbeatDirectory, recoverySecretPath, uid, gid }) {
  if (!path.isAbsolute(storageDirectory) || !path.isAbsolute(heartbeatDirectory) || !path.isAbsolute(recoverySecretPath)) {
    throw new Error("The E2E PDF mounts must use absolute temporary paths.");
  }
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0) {
    throw new Error("The E2E PDF worker requires a non-root Linux user.");
  }
  return [
    "create", "--name", name, "--label", "perfectutilitares.e2e=" + name,
    "--network", "host", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--memory", "1536m", "--cpus", "2", "--pids-limit", "256",
    "--user", uid + ":" + gid, "--workdir", "/app",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m,uid=" + uid + ",gid=" + gid + ",mode=1770",
    "--volume", storageDirectory + ":" + storageDirectory,
    "--volume", heartbeatDirectory + ":/app/data/pdf-jobs",
    "--volume", recoverySecretPath + ":/run/secrets/password_recovery_secret:ro",
    ...workerEnvironment.flatMap(name => ["--env", name]),
    image, "node", "/app/dist/pdf-worker.mjs",
  ];
}

export async function linkPdfWorkerHeartbeat(hostPath, workerDirectory) {
  const directory = path.join(workerDirectory, "data", "pdf-jobs");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, path.basename(hostPath));
  // Do not replace an existing path. The app reads this one task-owned link;
  // the container atomically renames the heartbeat inside the temporary mount.
  await symlink(target, hostPath);
  return { directory, target };
}

export async function unlinkPdfWorkerHeartbeat(hostPath, expectedTarget) {
  let actual;
  try { actual = await readlink(hostPath); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (actual !== expectedTarget) throw new Error("The E2E PDF heartbeat link changed; refusing cleanup.");
  await unlink(hostPath);
}
