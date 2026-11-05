import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (!new Set(["build", "deploy"]).has(mode)) {
  console.error("Uso: node scripts/docker-production.mjs <build|deploy>");
  process.exit(2);
}

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

function assertRunningRevision(service, revision, env) {
  const ids = run(
    "docker",
    ["compose", "ps", "--quiet", "--status", "running", service],
    { env, capture: true },
  ).split(/\r?\n/).filter(Boolean);
  if (!ids.length) {
    throw new Error(`Nenhum contêiner de ${service} está em execução após o deploy.`);
  }

  const states = run(
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

try {
  const revision = run("git", ["rev-parse", "HEAD"], { capture: true });
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status) {
    throw new Error("O build de produção exige o repositório limpo para registrar a revisão correta.");
  }

  const env = {
    ...process.env,
    BUILDKIT_PROGRESS: process.env.BUILDKIT_PROGRESS ?? "plain",
    BUILD_DATE: new Date().toISOString(),
    SOURCE_REVISION: revision,
  };

  run("docker", ["compose", "config", "--quiet"], { env });
  run("docker", ["compose", "build", "migrate", "app", "pdf-worker", "escalas-solver"], { env });

  if (mode === "deploy") {
    run(
      "docker",
      [
        "compose", "up", "-d", "--no-build", "--wait", "--wait-timeout", "180",
        "app", "pdf-worker", "escalas-solver",
      ],
      { env },
    );
    assertRunningRevision("app", revision, env);
    assertRunningRevision("pdf-worker", revision, env);
    run("docker", ["compose", "ps"], { env });
  }

  // O cache do builder pode ser compartilhado por outros projetos do servidor.
  if (
    process.env.ENABLE_BUILDKIT_GC === "1" &&
    process.env.SKIP_BUILDKIT_GC !== "1"
  ) {
    run("docker", [
      "builder",
      "prune",
      "--force",
      "--filter",
      "until=168h",
    ]);
    run("docker", ["builder", "prune", "--force", "--max-used-space=15gb"]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
