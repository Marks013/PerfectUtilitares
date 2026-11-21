import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { EscalaError } from "./errors";
import { stableEscalaJson } from "./operational-input-policy";
import type { EscalaInput } from "./types";

export type EscalaProposalScope = { tenantId: string; principal: string; session: string;
  workspaceId: string; revision: number; approvalId: string | null; accessVersion: string };
function secret() {
  const value = process.env.UNIMED_ACCESS_COOKIE_SECRET?.trim();
  if (!value || value.length < 32) throw new EscalaError(503, "ESCALA_ACCESS_UNAVAILABLE", "A assinatura de propostas não está disponível.");
  return value;
}
const digest = (input: EscalaInput) => createHash("sha256").update(stableEscalaJson(input)).digest("hex");
export function signEscalaProposal(scope: EscalaProposalScope, input: EscalaInput, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ v: 1, scope, hash: digest(input), expires: now + 15 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`escala-proposal:${body}`).digest("base64url")}`;
}
export function verifyEscalaProposal(proof: string, scope: EscalaProposalScope, input: EscalaInput, now = Date.now()) {
  let valid = false;
  try {
    if (proof.length > 4096) throw new Error("size");
    const [body, signature, extra] = proof.split(".");
    if (!body || !signature || extra) throw new Error("format");
    const expected = Buffer.from(createHmac("sha256", secret()).update(`escala-proposal:${body}`).digest("base64url"));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("signature");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    valid = payload.v === 1 && payload.expires > now && payload.expires <= now + 15 * 60_000
      && payload.hash === digest(input) && stableEscalaJson(payload.scope) === stableEscalaJson(scope);
  } catch { valid = false; }
  if (!valid) throw new EscalaError(409, "ESCALA_PROPOSAL_INVALID", "A proposta expirou ou não corresponde a este acesso e revisão. Gere outra proposta.");
}
