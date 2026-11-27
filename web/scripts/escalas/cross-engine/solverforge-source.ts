import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const timefoldControlRevision = "71945cd6e73c48b424dab1297fbc3bf8a15ae585";

const harness = [
  "web/scripts/escalas/cross-engine/core.ts",
  "web/scripts/escalas/cross-engine/fixtures.ts",
  "web/scripts/escalas/cross-engine/docker.ts",
  "web/scripts/escalas/cross-engine/cli.ts",
  "web/scripts/escalas/cross-engine/solverforge-compare.ts",
  "web/scripts/escalas/cross-engine/solverforge-source.ts",
  "web/experiments/escalas-solverforge/src/e3a-fixed-clock-contract.json",
] as const;

type Checkout = {
  evaluatorRoot: string;
  evaluatorRevision: string;
  candidateRoot: string;
  candidateRevision: string;
  controlRevision: string;
};

function git(root: string, ...args: string[]): Buffer {
  const command = spawnSync("git", ["-C", root, ...args], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (command.error || command.status !== 0) throw Error("FORGE_GIT_IDENTITY");
  return command.stdout;
}

function revision(root: string, expected: string) {
  if (!/^[a-f0-9]{40}$/.test(expected) ||
      git(root, "rev-parse", "HEAD").toString().trim() !== expected ||
      realpathSync(git(root, "rev-parse", "--show-toplevel").toString().trim()) !== root) {
    throw Error("FORGE_GIT_IDENTITY");
  }
}

function absoluteRoots(checkout: Checkout) {
  const evaluatorRoot = realpathSync(checkout.evaluatorRoot);
  const candidateRoot = realpathSync(checkout.candidateRoot);
  if (evaluatorRoot === candidateRoot) throw Error("FORGE_CHECKOUTS_NOT_SEPARATE");
  revision(evaluatorRoot, checkout.evaluatorRevision);
  revision(candidateRoot, checkout.candidateRevision);
  return { ...checkout, evaluatorRoot, candidateRoot };
}

function harnessContents(checkout: Checkout) {
  const sources = harness.map(path => {
    const entry = git(checkout.candidateRoot, "ls-tree", checkout.candidateRevision, "--", path).toString();
    if (!/^100644 blob [a-f0-9]{40}\t/.test(entry)) throw Error("FORGE_HARNESS_NOT_REGULAR");
    return { path, bytes: git(checkout.candidateRoot, "show", `${checkout.candidateRevision}:${path}`) };
  });
  for (const { path, bytes } of sources.slice(0, 2)) {
    if (!git(checkout.candidateRoot, "show", `${checkout.controlRevision}:${path}`).equals(bytes)) {
      throw Error("FORGE_FROZEN_COMPARATOR_MISMATCH");
    }
  }
  return sources;
}

function verifyEvaluatorWorkdir(root: string, prepared: boolean) {
  const status = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all").toString().split("\0").filter(Boolean);
  const expected = prepared ? [...harness.map(path => `?? ${path}`)].sort() : [];
  if (status.length !== expected.length || status.sort().some((entry, i) => entry !== expected[i])) {
    throw Error("FORGE_DIRTY_EVALUATOR");
  }
}

/** Copy only reviewed harness paths from the candidate Git object, never from its worktree. */
export function prepareEvaluator(checkout: Checkout) {
  const roots = absoluteRoots(checkout);
  verifyEvaluatorWorkdir(roots.evaluatorRoot, false);
  for (const { path, bytes } of harnessContents(roots)) {
    const destination = join(roots.evaluatorRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    if (realpathSync(dirname(destination)) !== dirname(destination)) throw Error("FORGE_HARNESS_PATH");
    writeFileSync(destination, bytes, { flag: "wx" });
  }
  return frozenBenchmarkSource(roots);
}

/** Root used by imports is always the evaluator, never the release candidate. */
export function frozenBenchmarkSource(checkout: Checkout) {
  const roots = absoluteRoots(checkout);
  verifyEvaluatorWorkdir(roots.evaluatorRoot, true);
  const digest = createHash("sha256");
  for (const { path, bytes } of harnessContents(roots)) {
    const file = join(roots.evaluatorRoot, path);
    if (!lstatSync(file).isFile() || realpathSync(file) !== file || !readFileSync(file).equals(bytes)) {
      throw Error("FORGE_HARNESS_MISMATCH");
    }
    digest.update(path).update("\0").update(String(bytes.length)).update("\0").update(bytes);
  }
  return {
    revision: roots.candidateRevision,
    evaluatorRevision: roots.evaluatorRevision,
    evaluatorTree: git(roots.evaluatorRoot, "rev-parse", `${roots.evaluatorRevision}:web/src/lib/escalas`).toString().trim(),
    comparatorBlob: git(roots.candidateRoot, "rev-parse", `${roots.controlRevision}:${harness[0]}`).toString().trim(),
    harnessSha256: digest.digest("hex"),
  };
}

export function currentBenchmarkSource(evaluatorRevision: string) {
  const candidateRoot = process.env.ESCALAS_FORGE_CANDIDATE_ROOT;
  const candidateRevision = process.env.ESCALAS_FORGE_CANDIDATE_REVISION;
  if (!candidateRoot || !candidateRevision) throw Error("FORGE_CHECKOUT_ARGS");
  return frozenBenchmarkSource({
    evaluatorRoot: resolve(process.cwd(), ".."),
    evaluatorRevision,
    candidateRoot,
    candidateRevision,
    controlRevision: timefoldControlRevision,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [evaluatorRoot, evaluatorRevision, candidateRoot, candidateRevision, controlRevision, ...extra] = process.argv.slice(2);
  if (!evaluatorRoot || !evaluatorRevision || !candidateRoot || !candidateRevision || !controlRevision || extra.length) {
    throw Error("FORGE_CHECKOUT_ARGS");
  }
  console.log(JSON.stringify(prepareEvaluator({ evaluatorRoot, evaluatorRevision, candidateRoot, candidateRevision, controlRevision })));
}
