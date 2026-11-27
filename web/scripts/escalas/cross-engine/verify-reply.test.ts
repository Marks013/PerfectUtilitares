import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { verifyReply } from "./core";

test("preserves Forge admission and response-validation HTTP failures", () => {
  for (const [httpStatus, error] of [[422, "SOLVER_UNSUPPORTED_INPUT"], [502, "SOLVER_RESPONSE_INVALID"]] as const) {
    const body = { error };
    deepEqual(verifyReply({ httpStatus, body, maxRssKiB: null }), {
      httpStatus, body, maxRssKiB: null, cgroup: null,
    });
  }
});

test("rejects unrelated HTTP statuses and HTTP 200 without a solver result", () => {
  throws(() => verifyReply({ httpStatus: 418, body: { error: "UNKNOWN" }, maxRssKiB: null }), /REPLY_INVALID/);
  throws(() => verifyReply({ httpStatus: 200, body: { error: "UNKNOWN" }, maxRssKiB: null }), /STATUS_INVALID/);
});
