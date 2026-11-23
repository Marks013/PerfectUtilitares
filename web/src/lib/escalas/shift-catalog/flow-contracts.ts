import { z } from "zod";
import { isDate } from "../dates";
import type { TurnoCatalogEntryDto, TurnoCatalogPageDto, TurnoExportOmissionDto } from "./contracts";

/** Additive contract. Existing manifest bodies and DTOs keep version 1 semantics. */
const id = z.string().min(1).max(100);
const code = z.number().int().min(1500).max(2_147_483_647);
const source = z.strictObject({ workspaceId: id, revision: z.number().int().min(1).max(2_000_000_000) });
const personKey = z.strictObject({ workspaceId: id, employeeId: id });
const filters = z.strictObject({
  branchCodes: z.array(z.string().min(1).max(160)).max(50),
  employeeKeys: z.array(personKey).max(1000),
  sectors: z.array(z.strictObject({ workspaceId: id, value: z.string().max(160) })).max(1000),
  catalogCodes: z.array(code).max(5000),
  registrations: z.array(z.string().max(160)).max(1000),
});
const common = { selectionVersion: z.literal(2), year: z.number().int().min(2026).max(9999),
  month: z.number().int().min(1).max(12), filters };
export const turnoSelectionManifestSchema = z.union([
  z.strictObject({ ...common, mode: z.literal("CATALOG"), scope: z.enum(["ALL", "USED"]),
    sources: z.array(source).max(50), codes: z.array(code).min(1).max(5000) }),
  z.strictObject({ ...common, mode: z.literal("EMPLOYEES"), sources: z.array(source).min(1).max(50),
    members: z.array(personKey.extend({ localShiftId: id.nullable() })).min(1).max(1000) }),
]).superRefine((value, context) => {
  const problem = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(value.sources.map(entry => entry.workspaceId)).size !== value.sources.length) problem("Planejamentos duplicados.");
  if (value.mode === "CATALOG") {
    if (new Set(value.codes).size !== value.codes.length) problem("Códigos duplicados.");
    if (value.scope === "ALL" && (value.sources.length || value.filters.branchCodes.length || value.filters.employeeKeys.length
      || value.filters.sectors.length || value.filters.registrations.length)) problem("Filtros de uso exigem fontes e alcance USED.");
    if (value.scope === "USED" && !value.sources.length) problem("Escolha as fontes de uso.");
  } else {
    const keys = value.members.map(entry => JSON.stringify([entry.workspaceId, entry.employeeId]));
    if (new Set(keys).size !== keys.length) problem("Pessoas duplicadas.");
    const counts = new Map<string, number>();
    for (const member of value.members) counts.set(member.workspaceId, (counts.get(member.workspaceId) ?? 0) + 1);
    if ([...counts.values()].some(count => count > 250)) problem("Selecione até 250 pessoas por fonte.");
  }
});

export type TurnoSelectionManifestRequest = z.infer<typeof turnoSelectionManifestSchema>;
export type TurnoFlowPersonKey = z.infer<typeof personKey>;
export type TurnoFlowFilters = z.infer<typeof filters>;
export type TurnoSelectionOmission = TurnoFlowPersonKey & {
  registration: string;
  reason: TurnoExportOmissionDto["reason"] | "REGISTRATION_MISSING" | "STALE_REFERENCE" | "AMBIGUOUS_REFERENCE";
};
export type TurnoSelectionBlocker = { reason: "DUPLICATE_REGISTRATION"; members: TurnoFlowPersonKey[]; message: string };
export type TurnoEmployeeExportLine = TurnoFlowPersonKey & {
  registration: string; localShiftId: string; branchCode: string; code: number; markings: TurnoCatalogEntryDto["markings"];
};
export const TURNO_CATALOG_EXPORT_FORMATS = ["TXT2", "CADASTRO"] as const;
export const TURNO_EMPLOYEE_EXPORT_FORMATS = ["TXT1", "TXT2", "CADASTRO", "VINCULOS"] as const;
type TurnoSelectionCounts = { found: number; selected: number; includedEmployees: number; includedCodes: number;
  txt1Lines: number; txt2Lines: number; omitted: number; blockers: number };
type ManifestCommon = { selectionVersion: 2; manifestId: string; expiresAt: string; selectionDigest: string;
  counts: TurnoSelectionCounts; omissions: TurnoSelectionOmission[]; blockers: TurnoSelectionBlocker[] };
export type TurnoSelectionManifestDto = ManifestCommon & (
  | { mode: "CATALOG"; context: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }>;
      rows: TurnoCatalogEntryDto[]; formats: typeof TURNO_CATALOG_EXPORT_FORMATS }
  | { mode: "EMPLOYEES"; context: Extract<TurnoSelectionManifestRequest, { mode: "EMPLOYEES" }>;
      rows: TurnoEmployeeExportLine[]; formats: typeof TURNO_EMPLOYEE_EXPORT_FORMATS }
);

export const turnoCatalogOptionsSchema = z.strictObject({
  workspaceId: id, expectedRevision: z.coerce.number().int().min(1).max(2_000_000_000), employeeId: id,
  effectiveFrom: z.string().refine(isDate), effectiveUntil: z.string().refine(isDate),
  search: z.string().trim().max(48).default(""), cursor: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).refine(value => value.effectiveFrom <= value.effectiveUntil, "Confira o período da atribuição.");
export type TurnoCatalogOptionsRequest = z.infer<typeof turnoCatalogOptionsSchema>;
export type TurnoCatalogOptionsDto = TurnoCatalogPageDto & { context: {
  workspaceId: string; revision: number; employeeId: string; effectiveFrom: string; effectiveUntil: string;
} };
