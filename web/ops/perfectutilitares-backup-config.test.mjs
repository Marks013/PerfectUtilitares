import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("./perfectutilitares-backup", import.meta.url), "utf8");
const example = readFileSync(new URL("./perfectutilitares-backup.conf.example", import.meta.url), "utf8");

function assignments(text) {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/gm)].map(([, key, value]) => [key, value]);
}

test("documented backup knobs match the script defaults exactly", () => {
  for (const [key, value] of assignments(example)) {
    const initialization = new RegExp("^" + key + "=\\$\\{" + key + ":-([^}]*)\\}", "m").exec(script);
    assert.ok(initialization, key + " must be read by the backup script");
    assert.equal(value, initialization[1], key + " unexpectedly changes the documented retention");
  }
  assert.deepEqual(assignments(example).map(([key]) => key), [
    "BACKUP_ROOT", "BACKUP_DAILY_KEEP_DAYS", "BACKUP_MAX_AGE_DAYS", "BACKUP_RCLONE_REMOTE",
  ]);
});

test("deprecated count-based retention must not reappear", () => {
  assert.doesNotMatch(example, /(?:^|\n)BACKUP_KEEP_COUNT=/);
  assert.match(script, /if \[ "\$age_days" -gt "\$BACKUP_MAX_AGE_DAYS" \]/);
  assert.match(script, /if \[ "\$age_days" -le "\$BACKUP_DAILY_KEEP_DAYS" \]/);
});
