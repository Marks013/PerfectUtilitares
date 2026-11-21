/** A candidate is separate from a saved draft. Saving does not apply it. */
export function pendingNavigation(dirty: boolean, candidatePending: boolean, discard: boolean) {
  return !discard && (dirty || candidatePending);
}
