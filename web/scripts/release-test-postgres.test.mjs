import assert from "node:assert/strict";
import { test } from "node:test";
import { releasePostgresImage, releaseTestDatabase, releaseTestDatabaseUrl, releaseTestPostgresId } from "./release-test-postgres.mjs";

const id = "a".repeat(64);
const nonce = "b".repeat(16);
const env = { ESCALAS_RELEASE_POSTGRES_ID: id };
const data = "/var/lib/postgresql/data";
const service = () => ({
  Id: id, Name: "/perfectutilitares-release-pg-" + nonce,
  State: { Running: true, Health: { Status: "healthy" } },
  Config: { Image: releasePostgresImage, Labels: { "com.perfectutilitares.release-test": nonce },
    Env: ["POSTGRES_DB=perfectutilitares_release_test", "POSTGRES_USER=release_quality", "POSTGRES_PASSWORD=" + "x".repeat(48)] },
  HostConfig: { Binds: [], Tmpfs: { [data]: "rw" } },
  Mounts: [{ Type: "tmpfs", Destination: data }],
  NetworkSettings: { Networks: { ["perfectutilitares-release-net-" + nonce]: { IPAddress: "172.30.13.2" } }, Ports: { "5432/tcp": null } },
});

test("verifies the dedicated ephemeral service before providing its connection details", () => {
  assert.equal(releaseTestPostgresId({}), undefined);
  const database = releaseTestDatabase(env, target => { assert.equal(target, id); return service(); });
  assert.equal(database.username, "release_quality");
  const url = releaseTestDatabaseUrl(database);
  assert.equal(url.origin, "null");
  assert.equal(url.hostname, "172.30.13.2");
  assert.equal(url.pathname, "/perfectutilitares_release_test");
});

test("rejects mixed CI profiles and non-exact target identifiers before inspecting Docker", () => {
  function forbidden() { assert.fail("unexpected Docker inspection"); }
  assert.throws(() => releaseTestDatabase({ ...env, CI: "true" }, forbidden), /non-CI/);
  assert.throws(() => releaseTestDatabase({ ESCALAS_RELEASE_POSTGRES_ID: "web-db-1" }, forbidden), /exact test container/);
});

test("rejects production, shared networks, persistent storage and exposed ports", () => {
  const mutations = [
    target => { target.Config.Labels["com.docker.compose.project"] = "web"; },
    target => { target.NetworkSettings.Networks.web = { IPAddress: "172.30.0.2" }; },
    target => { target.Mounts[0].Type = "bind"; },
    target => { target.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "5432" }]; },
  ];
  for (const mutate of mutations) {
    const target = service(); mutate(target);
    assert.throws(() => releaseTestDatabase(env, () => target), /not a verified disposable/);
  }
});
