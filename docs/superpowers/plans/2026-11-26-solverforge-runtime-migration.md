# SolverForge-only branch runtime migration

Goal: replace the OR-Tools runtime on the consolidated development branch, without deploying or implying production readiness.

Architecture: retain the private authenticated HTTP API, structural validation and independent TypeScript acceptance policy. Replace CP-SAT with a bounded, directly supervised SolverForge subprocess. No runtime fallback. Keep the immutable OR-Tools reference only in Git history and the existing frozen comparison workflow; do not retain a second production solver. Unsupported input remains explicitly unsupported, not infeasible, unknown, or rewritten synthetic input.

Constraints: original semantic parity checks, external comparators, benchmark inputs, quotas and Rust lock remain unchanged. Main and PR 75 original branch are not updated. Production migration is blocked until full functional/expanded/performance qualification succeeds.

- [ ] Add failing transport/native lifecycle and no-OR-Tools-runtime tests.
- [ ] Implement stdlib-only bounded native bridge; authenticate first, cancel/timeout and reap exact process group before release; validate reply and limits without logging payload.
- [ ] Rewire runtime container/Compose/CI. Remove CP-SAT algorithms/config/dependencies from active tree. Extract identical neutral fixture helpers for original independent parity checks. Inventory deletions and preserve exact frozen reference.
- [ ] Validate native tests/Clippy/build, service HTTP success/cancel/failures and original independent checks. Record any parity failure without skips.
- [ ] Publish one consolidated verified migration commit to the development branch only.

Review focus: orphan grandchildren; forged/malformed/oversized native responses; unsupported real input; wrong binary or stale build; a test move or removed dependency accidentally masking an unimplemented labor rule.

## Recovery decisions

- Separate `--service` admission from unchanged synthetic benchmark admission. Permit ordinary identifiers only within the implemented CUSTOM/MANUAL/SUNDAY v3 model; no field rewriting, policy bypass or infeasibility claim for unsupported input.
- Restore public behavior assertions removed by the interrupted cleanup. Retire optimizer-internal tests only with per-test inventory, and leave unported contracts as an explicit failing migration gate.
- Harden native reply correspondence and lifecycle. Run the actual HTTP success path, complete native suite and independent contract checks. Known contract failures block main; this branch is a development migration, not release approval.
