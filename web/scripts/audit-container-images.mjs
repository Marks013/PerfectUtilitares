import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scanner =
  "aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
const images = process.argv.slice(2);
if (images.length === 0)
  images.push("web-app", "web-pdf-worker", "web-migrate");

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const revisionResult = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
});
if (revisionResult.error) throw revisionResult.error;
if (revisionResult.status !== 0) {
  throw new Error(revisionResult.stderr.trim() || "Git revision unavailable.");
}
const expectedRevision = revisionResult.stdout.trim();
const expectedSource = "https://github.com/Marks013/PerfectUtilitares";

const cacheDir = resolve(
  process.env.TRIVY_CACHE_DIR ?? "../storage/trivy-cache",
);
mkdirSync(cacheDir, { recursive: true });

let failed = false;
for (const image of images) {
  const inspect = spawnSync(
    "docker",
    ["image", "inspect", image, "--format", "{{json .Config.Labels}}"],
    { encoding: "utf8" },
  );
  if (inspect.error) throw inspect.error;
  if (inspect.status !== 0) {
    console.error(`Imagem indisponivel para auditoria OCI: ${image}`);
    failed = true;
    continue;
  }
  const labels = JSON.parse(inspect.stdout.trim() || "{}");
  const requiredLabels = {
    "org.opencontainers.image.title": labels["org.opencontainers.image.title"],
    "org.opencontainers.image.description":
      labels["org.opencontainers.image.description"],
    "org.opencontainers.image.source": labels["org.opencontainers.image.source"],
    "org.opencontainers.image.version": labels["org.opencontainers.image.version"],
    "org.opencontainers.image.revision":
      labels["org.opencontainers.image.revision"],
    "org.opencontainers.image.created": labels["org.opencontainers.image.created"],
  };
  const missingLabels = Object.entries(requiredLabels)
    .filter(([, value]) => typeof value !== "string" || value.trim() === "")
    .map(([key]) => key);
  const created = requiredLabels["org.opencontainers.image.created"];
  const metadataValid =
    missingLabels.length === 0 &&
    requiredLabels["org.opencontainers.image.source"] === expectedSource &&
    requiredLabels["org.opencontainers.image.version"] === packageVersion &&
    requiredLabels["org.opencontainers.image.revision"] === expectedRevision &&
    typeof created === "string" &&
    Number.isFinite(Date.parse(created));
  if (!metadataValid) {
    console.error(
      `Rastreabilidade OCI invalida em ${image}${
        missingLabels.length ? `; ausentes: ${missingLabels.join(", ")}` : ""
      }.`,
    );
    failed = true;
  } else {
    console.log(
      `OCI: ${image} -> ${expectedRevision.slice(0, 12)} @ ${created}`,
    );
  }

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
