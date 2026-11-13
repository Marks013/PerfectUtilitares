const stages = new Set(["transport-body", "transport-json", "transport-http", "refinement", "result-schema", "assignment-schema", "completeness", "preservation", "selection-recheck", "independent-validation", "result-recheck", "service-schema", "service-preservation", "service-validation", "service-recheck"]);
const codes = new Set(["BODY_MISSING", "BODY_LIMIT", "BODY_READ", "JSON_INVALID", "HTTP_REJECTED", "REFINEMENT_FAILED", "SCHEMA_INVALID", "MISSING_ACTIVE_DATE", "ASSIGNMENT_COUNT", "ABSENCE_CHANGED", "LOCK_CHANGED", "UNEXPECTED_ASSIGNMENTS", "PROTECTED_ASSIGNMENT_CHANGED", "RULES_INVALID", "HOURS_ONLY_CHANGED", "REST_ONLY_CHANGED", "RECHECK_FAILED"]);
const rules = new Set(["invalid_type", "invalid_value", "invalid_format", "too_big", "too_small", "unrecognized_keys", "invalid_union", "custom", "SATURDAY_REST_FORBIDDEN", "CONSECUTIVE_REST_LIMIT", "DAY_PENDING", "WEEKLY_MINUTES", "WEEKLY_WORK_DAYS", "DAYS_WORKED", "WEEKLY_REST", "INTER_SHIFT_REST", "CONSECUTIVE_WORK", "DAILY_LIMIT", "MEAL_INTERVAL", "STORE_CLOSING_EXCEEDED", "SHIFT_NOT_ALLOWED", "SCHEDULE_MODE", "ABSENCE_OCCUPIED", "HOLIDAY_CLOSURE", "OFF_OCCUPIED", "FIXED_OFF", "COVERAGE", "OUTSIDE_EMPLOYMENT"]);
const fields = new Set(["assignments", "employees", "shifts", "segments", "kind", "date", "employeeId", "shiftId", "locked", "start", "end", "status", "message", "wallTimeSeconds", "optimization", "phases", "objective", "members", "solverDiagnostics"]);
// Literal rule codes from the independent Escalas validators; unknown extensions remain masked.
for (const code of ["ABSENCE_AVAILABILITY", "ACTIVE_EMPLOYEES_PENDING", "CCT_HOLIDAY_CERTIFICATE", "CCT_HOLIDAY_REST", "CCT_NIGHT_CERTIFICATE", "CCT_PUBLIC_SERVICE_PENDING", "CCT_SUNDAY_CERTIFICATE", "CCT_VALIDITY", "CIVIL_TIME_INVALID", "CLOSED_DATE", "COLLECTIVE_AGREEMENT_REQUIRED", "COMPENSATION_REQUIRED", "CONSECUTIVE_OFF", "CONSECUTIVE_PENDING", "CONTRACT_LIMIT", "COVERAGE_PENDING", "COVERAGE_REVIEW_PENDING", "DISABLED_ASSIGNMENT", "DISTRIBUTION_DAILY_LIMIT", "EMPLOYEES_PENDING", "EMPLOYEE_SHIFT_PENDING", "EMPLOYMENT_AVAILABILITY", "FIVE_BY_TWO", "FIVE_BY_TWO_POLICY_OUTDATED", "HISTORY_UNVERIFIED", "HOLIDAY_INVALID", "HOLIDAY_OCCUPIED", "HOLIDAY_REST", "HOLIDAY_WEEK", "HOLIDAY_WORK", "INPUT_INVALID", "MEAL_INTERVAL_EXCESSIVE", "MISSING_SCHEDULE", "NIGHT_CREDIT_PENDING", "NIGHT_RULE_PENDING", "ORGANIZATION_PENDING", "POLICY_PENDING", "POLICY_VALIDITY", "SCENARIO_OUTDATED", "SHIFTS_PENDING", "SHORT_REFERENCE_PRESERVED", "SIMULATION_SHORT_MEAL_FLEX", "SUNDAY_ROTATION", "SUNDAY_RULE_PENDING", "TRANSITION_WEEK_PENDING", "UNTIMED_REST_UNVERIFIED", "WEEKLY_LIMIT", "WORK_STREAK"]) rules.add(code);

type Details = { expected?: number; actual?: number; httpStatus?: number; issues?: readonly { code: string; path?: readonly PropertyKey[] }[] };
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(10_000_000, Math.max(0, Math.trunc(value))) : undefined;
}

/** Fixed diagnostics only. Never pass an exception, payload or identity to the log sink. */
export function logSolverRejection(stage: string, code: string, details: Details = {}): void {
  const ruleCounts: Record<string, number> = {};
  const paths = new Set<string>();
  for (const issue of details.issues ?? []) {
    const key = rules.has(issue.code) ? issue.code : "OTHER_RULE";
    ruleCounts[key] = (ruleCounts[key] ?? 0) + 1;
    if (issue.path && paths.size < 8) paths.add(issue.path.slice(0, 6).map(part => typeof part === "number" ? "[]" : typeof part === "string" && fields.has(part) ? part : "*").join("."));
  }
  try {
    console.error({ event: "escala_solver_rejected", stage: stages.has(stage) ? stage : "unknown", code: codes.has(code) ? code : "UNKNOWN",
      expected: count(details.expected), actual: count(details.actual),
      httpStatus: typeof details.httpStatus === "number" && details.httpStatus >= 100 && details.httpStatus <= 599 ? Math.trunc(details.httpStatus) : undefined,
      issueCount: details.issues?.length ?? 0, ruleCounts, paths: [...paths] });
  } catch { /* Observability must not replace the original public failure. */ }
}
