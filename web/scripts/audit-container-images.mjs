import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scanner =
  "aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
const images = process.argv.slice(2);
if (images.length === 0) images.push("web-app", "web-pdf-worker");

const cacheDir = resolve(
  process.env.TRIVY_CACHE_DIR ?? "../storage/trivy-cache",
);
mkdirSync(cacheDir, { recursive: true });

let failed = false;
for (const image of images) {
  console.log(`\nAuditoria de vulnerabilidades: ${image}`);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      "--volume",
      `${cacheDir}:/root/.cache/trivy`,
      scanner,
      "image",
      "--image-src",
      "docker",
      "--scanners",
      "vuln",
      "--severity",
      "HIGH,CRITICAL",
      "--exit-code",
      "1",
      image,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
