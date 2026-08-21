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
  run("docker", ["compose", "build", "migrate", "app", "pdf-worker"], { env });

  if (mode === "deploy") {
    run("docker", ["compose", "up", "-d", "app", "pdf-worker"], { env });
    run("docker", ["compose", "ps"], { env });
  }

  if (process.env.SKIP_BUILDKIT_GC !== "1") {
    run("docker", [
      "builder",
      "prune",
      "--force",
      "--filter",
      "until=168h",
      "--max-used-space=15gb",
    ]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
