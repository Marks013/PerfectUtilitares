import type { ReviewTarget } from "./validation-guidance";

export type EscalaRecoveryContext = { employeeId?: string; date?: string; sector?: string; role?: string; start?: number };
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

export function revealRecoveryTarget(target: ReviewTarget, document: Pick<Document, "getElementById">, context: EscalaRecoveryContext = {}): boolean {
  const direct = target === "team" && context.employeeId ? "escala-employee-editor"
    : target === "roster" && context.employeeId && context.date ? "escala-day-editor"
    : target === "coverage" && context.start !== undefined ? "escala-coverage-timeline"
    : target === "intervals" ? "escala-short-meal" : "";
  if (direct) {
    const destination = document.getElementById(direct);
    if (!destination) return false;
    revealRecoveryElement(destination);
    return true;
  }
  const preferred = target === "team" ? "escala-team-review" : target === "coverage" ? "escala-coverage-required" : "escala-" + target;
  const element = document.getElementById(preferred) ?? document.getElementById("escala-" + target);
  if (!element) return false;
  revealRecoveryElement(element);
  return true;
}
