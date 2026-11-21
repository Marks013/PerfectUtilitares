import { execFileSync } from "node:child_process";
import { isIPv4 } from "node:net";

export const releasePostgresImage = "postgres:17.10@sha256:a426e44bac0b759c95894d68e1a0ac03ecc20b619f498a91aae373bf06d8508d";
const releasePostgresDatabase = "perfectutilitares_release_test";

export function releaseTestPostgresId(env = process.env) {
  const id = env.ESCALAS_RELEASE_POSTGRES_ID;
  if (id === undefined) return undefined;
  if (!/^[a-f0-9]{64}$/.test(id) || env.CI) {
    throw new Error("The release PostgreSQL requires an exact test container ID and a non-CI release profile.");
  }
  return id;
}

function inspectContainer(id) {
  try {
    return JSON.parse(execFileSync("docker", ["inspect", id], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }))[0];
  } catch {
    throw new Error("The isolated release PostgreSQL could not be verified.");
  }
}

export function releaseTestDatabase(env = process.env, inspect = inspectContainer) {
  const id = releaseTestPostgresId(env);
  if (!id) throw new Error("No explicit release PostgreSQL was selected.");
  const info = inspect(id);
  const labels = info?.Config?.Labels ?? {};
  const nonce = labels["com.perfectutilitares.release-test"];
  const networks = Object.entries(info?.NetworkSettings?.Networks ?? {});
  const address = networks[0]?.[1]?.IPAddress;
  const dbVariables = Object.fromEntries((info?.Config?.Env ?? []).map(entry => {
    const position = entry.indexOf("=");
    return [entry.slice(0, position), entry.slice(position + 1)];
  }));
  const data = "/var/lib/postgresql/data";
  if (info?.Id !== id || !info?.State?.Running || info.State.Health?.Status !== "healthy"
    || info.Config?.Image !== releasePostgresImage || !/^[0-9a-f]{16}$/.test(nonce ?? "")
    || info.Name !== ("/perfectutilitares-release-pg-" + nonce) || labels["com.docker.compose.project"]
    || networks.length !== 1 || networks[0][0] !== "perfectutilitares-release-net-" + nonce
    || !isIPv4(address ?? "") || address.startsWith("127.")
    || info.HostConfig?.Binds?.length || !info.HostConfig?.Tmpfs?.[data]
    || info.Mounts?.some(entry => entry.Type !== "tmpfs" || entry.Destination !== data)
    || Object.values(info.NetworkSettings?.Ports ?? {}).some(port => port?.length)
    || dbVariables.POSTGRES_DB !== releasePostgresDatabase || dbVariables.POSTGRES_USER !== "release_quality"
    || !dbVariables.POSTGRES_PASSWORD || dbVariables.POSTGRES_PASSWORD.length < 32) {
    throw new Error("The selected PostgreSQL is not a verified disposable release test container.");
  }
  return { address, username: dbVariables.POSTGRES_USER, password: dbVariables.POSTGRES_PASSWORD };
}

export function releaseTestDatabaseUrl(database, name = releasePostgresDatabase) {
  const url = new URL("postgresql://localhost:5432/postgres");
  url.hostname = database.address;
  url.username = database.username;
  url.password = database.password;
  url.pathname = `/${name}`;
  return url;
}
