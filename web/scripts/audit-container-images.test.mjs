import assert from "node:assert/strict";
import test from "node:test";
import { parseImageTargets, validImageMetadata } from "./audit-container-images.mjs";

const current = "a".repeat(40);
const previous = "b".repeat(40);
const labels = {
  "org.opencontainers.image.title": "Solver",
  "org.opencontainers.image.description": "Private optimizer",
  "org.opencontainers.image.source": "https://github.com/Marks013/PerfectUtilitares",
  "org.opencontainers.image.version": "0.1.0",
  "org.opencontainers.image.revision": current,
  "org.opencontainers.image.created": "2026-11-05T18:00:00Z",
};

test("audits all four production images including Solver by default", () => {
  assert.deepEqual(parseImageTargets([], current), [
    { image: "web-app", revision: current },
    { image: "web-pdf-worker", revision: current },
    { image: "web-migrate", revision: current },
    { image: "web-escalas-solver", revision: current },
  ]);
});

test("component releases require explicit full revisions, never auto-trust labels", () => {
  assert.deepEqual(parseImageTargets(["web-app=" + previous, "web-escalas-solver"], current), [
    { image: "web-app", revision: previous },
    { image: "web-escalas-solver", revision: current },
  ]);
  for (const arg of ["web-app=", "web-app=HEAD", "web-app=273ac0f", "=bad", "--help", "web app", "app=" + current + "=extra"]) {
    assert.throws(() => parseImageTargets([arg], current));
  }
});

test("validates source, version, date and exact revision on every image", () => {
  assert.equal(validImageMetadata(labels, "0.1.0", current), true);
  assert.equal(validImageMetadata(labels, "0.1.0", previous), false);
  assert.equal(validImageMetadata({ ...labels, "org.opencontainers.image.revision": previous }, "0.1.0", previous), true);
  for (const key of Object.keys(labels)) {
    assert.equal(validImageMetadata({ ...labels, [key]: "" }, "0.1.0", current), false);
  }
  assert.equal(validImageMetadata({ ...labels, "org.opencontainers.image.source": "https://untrusted.example" }, "0.1.0", current), false);
  assert.equal(validImageMetadata({ ...labels, "org.opencontainers.image.created": "invalid" }, "0.1.0", current), false);
  assert.equal(validImageMetadata(labels, "0.2.0", current), false);
  assert.equal(validImageMetadata(null, "0.1.0", current), false);
});
