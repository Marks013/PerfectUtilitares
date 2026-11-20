/** Dependency-free Node/npm preflight for first-time installation and maintenance. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
  return match ? match.slice(1).map(Number) : null;
}

export function checkVersions(nodeVersion, npmVersion) {
  const node = versionParts(nodeVersion), npm = versionParts(npmVersion);
  const nodeOk = Boolean(node && node[0] === 24 && node[1] >= 19);
  const npmOk = Boolean(npm && npm[0] >= 11 && npm[0] < 13);
  return { ok: nodeOk && npmOk, nodeOk, npmOk };
}

function detectedNpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const fromAgent = /(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(userAgent);
  if (fromAgent) return fromAgent[1];
  const response = spawnSync("npm", ["--version"], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 });
  return response.status === 0 ? response.stdout.trim() : "unknown";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nodeVersion = process.version;
  const npmVersion = detectedNpmVersion();
  const result = checkVersions(nodeVersion, npmVersion);
  if (!result.ok) {
    console.error("Toolchain incompatível: Node " + nodeVersion + ", npm " + npmVersion +
      ". Use Node >=24.19.0 <25 e npm >=11 <13 (web/.nvmrc). Não alteramos seu Node automaticamente.");
    process.exitCode = 1;
  } else {
    console.log("Toolchain compatível: Node " + nodeVersion + ", npm " + npmVersion + ".");
  }
}
