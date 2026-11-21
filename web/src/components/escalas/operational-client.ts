import type { EscalaApprovedPolicyView, EscalaOperationalCommand, EscalaSessionResponse } from "@/lib/escalas/access-contracts";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaRequestError, responseCode } from "./workspace-feedback-model";

export const ESCALA_ACCESS_REQUEST_TIMEOUT_MS = 15_000;

async function accessDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = new AbortController();
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new DOMException("A consulta demorou além do esperado. Tente novamente.", "TimeoutError")), ESCALA_ACCESS_REQUEST_TIMEOUT_MS);
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(combined.reason);
    combined.addEventListener("abort", onAbort, { once: true });
  });
  try {
    combined.throwIfAborted();
    return await Promise.race([operation(combined), cancelled]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

async function readResponse<T>(response: Response, signal?: AbortSignal, notifyUnauthorized = true): Promise<T> {
  signal?.throwIfAborted();
  const body = await response.json().catch(() => null);
  signal?.throwIfAborted();
  if (!response.ok) {
    if (notifyUnauthorized && response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("escalas:unlock-required"));
    throw new EscalaRequestError(responseCode(body), response.status, body?.error?.message || "Não foi possível concluir. Seus dados foram preservados.");
  }
  if (!body || typeof body !== "object") throw new Error("O servidor não confirmou a operação. Confira o resultado antes de tentar novamente.");
  return body as T;
}

export async function startOperatorSession(username: string, send: typeof fetch = fetch, signal?: AbortSignal): Promise<EscalaSessionResponse> {
  return accessDeadline(async requestSignal => {
  const result = await readResponse<EscalaSessionResponse>(await send("/api/escalas/access/session", {
    method: "POST", cache: "no-store", signal: requestSignal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim() }),
  }), requestSignal, false);
  if (result.access?.role === "ACCOUNT" && result.context?.channel === "ACCOUNT" && Array.isArray(result.context.branches)) return result;
  if (result.access?.role !== "OPERATIONAL" || !result.access.expiresAt || !Number.isFinite(Date.parse(result.access.expiresAt))
    || result.context?.channel !== "USERNAME" || result.context.administrator || result.context.allBranches || !Array.isArray(result.context.branches)) {
    throw new Error("O acesso não foi confirmado. Informe novamente seu nome cadastrado.");
  }
  return result;
  }, signal);
}

export async function approvedPoliciesFor(target: { branchCode: string; startDate: string; endDate: string }, signal: AbortSignal, send: typeof fetch = fetch): Promise<EscalaApprovedPolicyView[]> {
  const query = new URLSearchParams(target);
  return accessDeadline(async requestSignal => {
  const result = await readResponse<{ policies: EscalaApprovedPolicyView[] }>(await send(`/api/escalas/approved-policy?${query}`, { cache: "no-store", signal: requestSignal }), requestSignal);
  if (!Array.isArray(result.policies)) throw new Error("O servidor não confirmou as configurações disponíveis.");
  return result.policies.filter(policy => !policy.revokedAt && canonicalBranchCode(policy.branchCode) === canonicalBranchCode(target.branchCode)
    && policy.startDate === target.startDate && policy.endDate === target.endDate);
  }, signal);
}

export async function operationalCommand(command: EscalaOperationalCommand, signal?: AbortSignal, send: typeof fetch = fetch): Promise<EscalaWorkspace> {
  return readResponse<EscalaWorkspace>(await send("/api/escalas", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) }), signal);
}

export async function accessRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return readResponse<T>(await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }), signal);
}
