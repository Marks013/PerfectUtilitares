import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync, statSync } from "node:fs";

const directory = `/home/ubuntu/perfectutilitares-config/audit-backup-${Date.now()}`;
try {
  mkdirSync(directory, { mode: 0o700 });
  const fd = openSync(`${directory}/database.dump`, "wx", 0o600);
  try {
    execFileSync("docker", ["exec", "web-db-1", "sh", "-c", 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], { stdio: ["ignore", fd, "pipe"], timeout: 180000 });
  } finally { closeSync(fd); }
  const fdRead = openSync(`${directory}/database.dump`, "r");
  let listing;
  try { listing = execFileSync("docker", ["exec", "-i", "web-db-1", "pg_restore", "--list"], { stdio: [fdRead, "pipe", "pipe"], encoding: "utf8" }); } finally { closeSync(fdRead); }
  const images = {};
  for (const [container, image] of [["web-app-1", "web-app:audit-before-20260908"], ["web-pdf-worker-1", "web-pdf-worker:audit-before-20260908"]]) {
    const id = execFileSync("docker", ["inspect", container, "--format", "{{.Image}}"], { encoding: "utf8" }).trim();
    execFileSync("docker", ["tag", id, image]);
    images[image] = id;
  }
  writeFileSync(`${directory}/recovery.json`, JSON.stringify({ sourceRevision: "68e0f37418c3a140aa15ddaf7a3ac1182d2725fa", images, createdAt: new Date().toISOString(), dumpBytes: statSync(`${directory}/database.dump`).size, archiveEntries: listing.split("\n").filter((line) => line && !line.startsWith(";")).length }, null, 2), { mode: 0o600 });
  console.log(`Backup verified: ${directory}; previous runtime images tagged.`);
} catch {
  console.error("Backup failed; details suppressed to protect production data.");
  process.exitCode = 1;
}
