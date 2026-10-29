import type { ReviewTarget } from "./validation-guidance";

export type EscalaRecoveryContext = { employeeId?: string; date?: string; sector?: string; role?: string };
export type EscalaRecoveryRequest = EscalaRecoveryContext & { target: ReviewTarget; request: number };

export function recoveryArea(target: ReviewTarget): "team" | "coverage" | "roster" | "adjustments" {
  return target === "team" || target === "coverage" || target === "roster" ? target : "adjustments";
}

/** Reveal only the requested section and its ancestors, after React has mounted that area. */
export function revealRecoveryElement(element: HTMLElement): void {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.tagName === "DETAILS") (current as HTMLDetailsElement).open = true;
  }
  const focus = element.tagName === "DETAILS" ? element.querySelector<HTMLElement>(":scope > summary") ?? element : element;
  focus.scrollIntoView({ behavior: "instant", block: "start" });
  focus.focus({ preventScroll: true });
}

export function revealRecoveryTarget(target: ReviewTarget, document: Pick<Document, "getElementById">): boolean {
  const preferred = target === "team" ? "escala-team-review" : target === "coverage" ? "escala-coverage-required" : "escala-" + target;
  const element = document.getElementById(preferred) ?? document.getElementById("escala-" + target);
  if (!element) return false;
  revealRecoveryElement(element);
  return true;
}
