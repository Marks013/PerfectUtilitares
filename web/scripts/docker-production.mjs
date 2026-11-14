import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { assertReleaseQuality } from "./release-quality.mjs";

export const productionServices = ["app", "pdf-worker", "escalas-solver"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} falhou${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

export function assertRunningRevision(service, revision, env, execute = run) {
  const ids = execute(
    "docker",
    ["compose", "ps", "--quiet", "--status", "running", service],
    { env, capture: true },
  ).split(/\r?\n/).filter(Boolean);
  if (!ids.length) {
    throw new Error(`Nenhum contêiner de ${service} está em execução após o deploy.`);
  }

  const states = execute(
    "docker",
    [
      "inspect",
      "--type", "container",
      "--format", '{{.State.Running}} {{index .Config.Labels "org.opencontainers.image.revision"}}',
      ...ids,
    ],
    { env, capture: true },
  ).split(/\r?\n/);
  if (states.length !== ids.length || states.some((state) => state !== `true ${revision}`)) {
    throw new Error(
      `Nem todos os contêineres de ${service} estão ativos na revisão ${revision}.`,
    );
  }
}

export function releaseProduction(mode, { execute = run, environment = process.env, quality = assertReleaseQuality } = {}) {
  if (!new Set(["build", "deploy"]).has(mode)) throw new Error("Uso: node scripts/docker-production.mjs <build|deploy>");
  const revision = execute("git", ["rev-parse", "HEAD"], { capture: true });
  function verifySource() {
    const status = execute("git", ["status", "--porcelain"], { capture: true });
    if (status || execute("git", ["rev-parse", "HEAD"], { capture: true }) !== revision) {
      throw new Error("O build de produção exige o repositório limpo e a mesma revisão durante o release.");
    }
    quality({ env: environment });
  }
  verifySource(); // No Docker command, including config, before complete quality proof.
  const env = {
    ...environment,
    BUILDKIT_PROGRESS: environment.BUILDKIT_PROGRESS ?? "plain",
    BUILD_DATE: new Date().toISOString(),
    SOURCE_REVISION: revision,
  };
  execute("docker", ["compose", "config", "--quiet"], { env });
  verifySource();
  execute("docker", ["compose", "build", "migrate", ...productionServices], { env });

  if (mode === "deploy") {
    verifySource();
    execute("docker", ["compose", "up", "-d", "--no-build", "--wait", "--wait-timeout", "180", ...productionServices], { env });
    for (const service of productionServices) assertRunningRevision(service, revision, env, execute);
    execute("docker", ["compose", "ps"], { env });
  }

  // O cache do builder pode ser compartilhado por outros projetos do servidor.
  if (environment.ENABLE_BUILDKIT_GC === "1" && environment.SKIP_BUILDKIT_GC !== "1") {
    execute("docker", ["builder", "prune", "--force", "--filter", "until=168h"]);
    execute("docker", ["builder", "prune", "--force", "--max-used-space=15gb"]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Informe somente build ou deploy.");
    releaseProduction(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
