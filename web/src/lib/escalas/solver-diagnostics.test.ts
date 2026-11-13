import { describe, expect, it, vi } from "vitest";
import { logSolverRejection } from "./solver-diagnostics";

describe("fixed solver rejection diagnostics", () => {
  it("emits counts and masked structural paths without exception or payload fields", () => {
    const sentinel = "PRIVATE_LOG_SENTINEL";
    const details = { expected: 7, actual: 2, payload: sentinel,
      issues: [{ code: sentinel, path: ["assignments", sentinel, 3, "shiftId"], employeeId: sentinel, message: sentinel },
        { code: "SATURDAY_REST_FORBIDDEN", employeeId: sentinel, message: sentinel },
        { code: "SATURDAY_REST_FORBIDDEN", employeeId: sentinel, message: sentinel }] };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logSolverRejection("assignment-schema", "SCHEMA_INVALID", details);
      expect(log).toHaveBeenCalledWith({ event: "escala_solver_rejected", stage: "assignment-schema", code: "SCHEMA_INVALID", expected: 7, actual: 2,
        httpStatus: undefined, issueCount: 3, ruleCounts: { OTHER_RULE: 1, SATURDAY_REST_FORBIDDEN: 2 }, paths: ["assignments.*.[].shiftId"] });
      logSolverRejection(sentinel, sentinel, details);
      expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "unknown", code: "UNKNOWN" }));
      expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    } finally { log.mockRestore(); }
  });
  it("does not replace the original failure if the diagnostic sink fails", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => { throw new Error("PRIVATE_SINK_SENTINEL"); });
    try { expect(() => logSolverRejection("transport-json", "JSON_INVALID")).not.toThrow(); }
    finally { log.mockRestore(); }
  });
});
