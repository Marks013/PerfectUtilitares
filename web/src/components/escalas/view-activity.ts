"use client";

import { useRef } from "react";

/** Keep an inactive area's existing DOM/state without processing newer draft snapshots. */
export function useActiveSnapshot<T>(value: T, active: boolean): T {
  const snapshot = useRef(value);
  if (active) snapshot.current = value;
  return snapshot.current;
}

/** Allow deactivation/reactivation renders; only skip subsequent inactive prop updates. */
export function inactiveViewPropsEqual(previous: { active?: boolean }, next: { active?: boolean }): boolean {
  return previous.active === false && next.active === false;
}
