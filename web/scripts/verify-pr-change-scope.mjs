/** Fail closed when a pull request hides file deletions or a test-only PR changes production code. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testOnlyTitle = /^test(?:\([^)]+\))?!?:\s/i;
const testFile = /\.(?:test|spec)\.(?:[cm]?[jt]sx?|py)$/;

function validPath(path) {
  return Boolean(path && !path.startsWith("/") && !path.includes("\\") && !/[\x00-\x1f]/.test(path)
    && path.split("/").every((segment) => segment && segment !== "." && segment !== ".."));
}

export function parseNameStatusZ(text) {
  const fields = text.split("\0");
  if (fields.pop() !== "") throw new Error("Git diff must be NUL-terminated");
  const changes = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^(?:A|M|D|T|U|R\d{1,3}|C\d{1,3})$/.test(status)) throw new Error("Unexpected git status: " + status);
    const firstPath = fields[i++];
    const hasSource = status.startsWith("R") || status.startsWith("C");
    const path = hasSource ? fields[i++] : firstPath;
    if (!validPath(firstPath) || !validPath(path)) throw new Error("Invalid or missing git path");
    changes.push({ status, path, previousPath: hasSource ? firstPath : null });
  }
  return changes;
}

export function declaredDeletions(body = "") {
  const blocks = [...String(body || "").matchAll(/<!--\s*intentional-deletions:\s*\r?\n([\s\S]*?)\r?\n\s*-->/g)];
  if (blocks.length > 1) throw new Error("Use a single intentional-deletions block");
  const lines = blocks.length ? blocks[0][1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  if (lines.some((path) => !validPath(path) || /[*?]/.test(path)) || new Set(lines).size !== lines.length) {
    throw new Error("Deletion declarations must be distinct, literal repository paths");
  }
  return new Set(lines);
}

export function isTestArtifact(path) {
  return testFile.test(path) || /(?:^|\/)(?:__tests__|tests|test|e2e|fixtures)(?:\/|$)/.test(path)
    || /(?:^|\/)test_[^/]+\.py$/.test(path) || path.endsWith(".snap");
}

export function auditPullRequest({ title, body, changes }) {
  const problems = [];
  let permitted;
  try {
    permitted = declaredDeletions(body);
  } catch (error) {
    return [String(error.message)];
  }
  const removed = changes.filter(({ status }) => status === "D" || status.startsWith("R"))
    .map(({ path, previousPath }) => previousPath ?? path);
  const undeclared = removed.filter((path) => !permitted.has(path));
  const unused = [...permitted].filter((path) => !removed.includes(path));
  if (undeclared.length) problems.push("Undeclared file removal/rename: " + undeclared.join(", "));
  if (unused.length) problems.push("Declared removals do not match the diff: " + unused.join(", "));
  if (testOnlyTitle.test(title || "")) {
    const unrelated = changes.filter(({ path, previousPath, status }) => !isTestArtifact(path)
      || (status.startsWith("R") && previousPath && !isTestArtifact(previousPath)));
    if (unrelated.length) problems.push("test: PR changes non-test files: " + unrelated.map((item) => item.path).join(", "));
  }
  return problems;
}

export function checkCurrentPullRequest(env = process.env, root = fileURLToPath(new URL("../../", import.meta.url))) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") return { skipped: true, problems: [] };
  if (!env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is missing");
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const request = event.pull_request;
  if (!request?.base?.sha || !request?.title) throw new Error("Missing pull request metadata");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
  const parents = git("rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/);
  if (parents.length !== 3 || parents[1] !== request.base.sha) {
    throw new Error("Expected the checked-out PR merge commit with the current base as first parent");
  }
  // Do not trim the NUL-delimited output: an empty diff is valid.
  const diff = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", parents[1], "HEAD"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const changes = parseNameStatusZ(diff);
  return { skipped: false, changes: changes.length,
    problems: auditPullRequest({ title: request.title, body: request.body, changes }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkCurrentPullRequest();
    if (result.skipped) console.log("PR diff gate skipped outside pull_request.");
    else if (result.problems.length) {
      for (const problem of result.problems) console.error("PR diff gate: " + problem);
      process.exitCode = 1;
    } else console.log("PR diff gate passed for " + result.changes + " changed file(s).");
  } catch (error) {
    console.error("PR diff gate failed closed: " + error.message);
    process.exitCode = 1;
  }
}
