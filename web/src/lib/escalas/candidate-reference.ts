import type { EscalaInput } from "./types";

/** Opaque server authentication. Clients retain this only with the matching proposalInput. */
export type EscalaCandidateReceipt = {
  version: 1;
  workspaceId: string;
  revision: number;
  issuedAt: number;
  expiresAt: number;
  baseHash: string;
  contextHash: string;
  inputHash: string;
  signature: string;
};

/** Optional GENERATE field comparisonReference; never a browser assertion of validity. */
export type EscalaCandidateReference = { input: EscalaInput; receipt: EscalaCandidateReceipt };

export type EscalaCandidateComparison = {
  admission: "NOT_PROVIDED" | "ADMITTED" | "EXPIRED" | "SCENARIO_CHANGED" | "INCOMPATIBLE";
  selection: "NOT_USED" | "REFERENCE_RETAINED" | "CANDIDATE_SELECTED";
  reason?: string;
};

/** Additional fields of the existing generation response; snapshot remains in proposalInput only. */
export type EscalaCandidateResponse = {
  candidateReceipt?: EscalaCandidateReceipt;
  comparison?: EscalaCandidateComparison;
};
