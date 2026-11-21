import type { EscalaCapability } from "./permissions";

/** Server-produced display contract. UI visibility never substitutes for endpoint authorization. */
export type EscalaClientAccess = Readonly<{
  channel: "ACCOUNT" | "USERNAME";
  roleLabel: string;
  administrator: boolean;
  /** True only for the existing authenticated administrator, within their tenant. */
  allBranches: boolean;
  branches: readonly Readonly<{
    code: string;
    label: string;
    capabilities: readonly EscalaCapability[];
  }>[];
  expiresAt?: string;
}>;
