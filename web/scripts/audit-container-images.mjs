import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scanner =
  "aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
const defaultImages = ["web-app", "web-pdf-worker", "web-migrate", "web-escalas-solver"];

// A component-only release may retain other images at an explicit Git revision.
// Omitted revisions still require HEAD; never infer trust from an image's label.
export function parseImageTargets(args, revision) {
  return (args.length ? args : defaultImages).map((arg) => {
    const parts = arg.split("=");
    const [image, explicitRevision] = parts;
    if (parts.length > 2 || !image || image.startsWith("-") || /\s/.test(image) ||
      (parts.length === 2 && !/^[a-f0-9]{40}$/.test(explicitRevision))) {
      throw new Error("Use imagem ou imagem=<hash Git completo de 40 caracteres>.");
    }
    return { image, revision: explicitRevision ?? revision };
  });
}

export function validImageMetadata(labels, version, revision) {
  const required = ["title", "description", "source", "version", "revision", "created"];
  if (!labels || required.some((key) => {
    const value = labels["org.opencontainers.image." + key];
    return typeof value !== "string" || value.trim() === "";
  })) return false;
  return labels["org.opencontainers.image.source"] === "https://github.com/Marks013/PerfectUtilitares" &&
    labels["org.opencontainers.image.version"] === version &&
    labels["org.opencontainers.image.revision"] === revision &&
    Number.isFinite(Date.parse(labels["org.opencontainers.image.created"]));
}

function main() {

  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const revisionResult = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (revisionResult.error) throw revisionResult.error;
  if (revisionResult.status !== 0) {
    throw new Error(revisionResult.stderr.trim() || "Git revision unavailable.");
  }
  const expectedRevision = revisionResult.stdout.trim();
  const targets = parseImageTargets(process.argv.slice(2), expectedRevision);
  for (const target of targets) {
    const commit = spawnSync("git", ["cat-file", "-e", target.revision + "^{commit}"], { encoding: "utf8" });
    if (commit.error) throw commit.error;
    if (commit.status !== 0) {
      throw new Error("A revisão esperada da imagem não existe no repositório.");
    }
  }

  const cacheDir = resolve(
    process.env.TRIVY_CACHE_DIR ?? "../storage/trivy-cache",
  );
  mkdirSync(cacheDir, { recursive: true });

  let failed = false;
  for (const { image, revision } of targets) {
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
    if (!validImageMetadata(labels, packageVersion, revision)) {
      console.error(`Rastreabilidade OCI invalida em ${image}.`);
      failed = true;
    } else {
      console.log(
        `OCI: ${image} -> ${revision.slice(0, 12)} @ ${labels["org.opencontainers.image.created"]}`,
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha na auditoria de imagens.");
    process.exitCode = 1;
  }
}
