import { spawnSync } from "node:child_process";

const commands = [
  {
    cmd: "docker",
    args: ["builder", "prune", "-af", "--filter", "until=168h"],
    label: "docker build cache",
  },
  {
    cmd: "docker",
    args: ["image", "prune", "-f"],
    label: "dangling docker images",
  },
  {
    cmd: "docker",
    args: ["container", "prune", "-f", "--filter", "until=24h"],
    label: "stopped docker containers",
  },
];

function run(command) {
  const result = spawnSync(command.cmd, command.args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    console.log(`skipped ${command.label}: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    console.log(`skipped ${command.label}: ${detail || `exit ${result.status}`}`);
    return;
  }

  const output = result.stdout.trim();
  console.log(output ? `${command.label}: ${output}` : `${command.label}: ok`);
}

commands.forEach(run);
