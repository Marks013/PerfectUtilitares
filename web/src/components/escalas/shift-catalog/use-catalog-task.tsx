"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useEscalaClientAccess } from "../access-context";
import { catalogError } from "./client";

/** Any new provider object is a fresh visual scope, never an inferred identity. */
export function CatalogScope({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const access = useEscalaClientAccess();
  const identity = useRef({ access, epoch: 0 });
  if (identity.current.access !== access) identity.current = { access, epoch: identity.current.epoch + 1 };
  const [eventEpoch, setEventEpoch] = useState(0), [locked, setLocked] = useState(false);
  useEffect(() => {
    const lock = () => setLocked(true);
    const unlock = () => { setLocked(false); setEventEpoch(value => value + 1); };
    window.addEventListener("escalas:unlock-required", lock); window.addEventListener("escalas:unlocked", unlock);
    return () => { window.removeEventListener("escalas:unlock-required", lock); window.removeEventListener("escalas:unlocked", unlock); };
  }, []);
  return allowed && !locked ? <Fragment key={`${identity.current.epoch}:${eventEpoch}`}>{children}</Fragment> : null;
}

export function useCatalogTask() {
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null), focusPending = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const reportError = useCallback((message: string, focus = false) => {
    if (!alive.current) return;
    focusPending.current = focus; setError(message);
    if (focus) setFocusRequest(value => value + 1);
  }, []);
  const invalidate = useCallback(() => { active.current?.abort(); active.current = null; focusPending.current = false; if (alive.current) { setBusy(""); setError(""); } }, []);
  useLayoutEffect(() => {
    const target = errorRef.current;
    if (!error || !focusRequest || !focusPending.current || !target?.isConnected) return;
    focusPending.current = false;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true });
  }, [error, focusRequest]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); active.current = null; }; }, []);
  useEffect(() => {
    const lock = () => { active.current?.abort(); active.current = null; };
    window.addEventListener("escalas:unlock-required", lock);
    return () => window.removeEventListener("escalas:unlock-required", lock);
  }, []);
  const run = useCallback(async <T,>(label: string, operation: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void, options: { focusOnError?: boolean; onError?: (message: string) => string } = {}): Promise<boolean> => {
    if (active.current || !alive.current) return false;
    const controller = new AbortController(); active.current = controller; focusPending.current = false; setBusy(label); setError("");
    try { const result = await operation(controller.signal); if (!alive.current || active.current !== controller || controller.signal.aborted) return false; accept(result); return true; }
    catch (cause) { if (alive.current && active.current === controller && !controller.signal.aborted) { const message = catalogError(cause); reportError(options.onError?.(message) ?? message, options.focusOnError); } return false; }
    finally { if (alive.current && active.current === controller) { active.current = null; setBusy(""); } }
  }, [reportError]);
  return { busy, error, errorRef, setError, reportError, invalidate, run, cancel: () => { invalidate(); setError("Espera cancelada. Confira o estado antes de repetir uma operação de gravação."); } };
}
