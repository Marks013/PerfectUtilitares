/** API contract shared by the Escalas backend and the turn catalog UI. */
export type TurnoClockMarks = readonly [string, string, string, string];

export type TurnoCatalogEntryDto = {
  code: number;
  markings: TurnoClockMarks;
  name: string;
};

export type TurnoCatalogPageDto = {
  entries: TurnoCatalogEntryDto[];
  nextCursor: string | null;
  pageSize: number;
};

export type TurnoCatalogSyncSource = {
  workspaceId: string;
  expectedRevision: number;
  localShiftIds: string[];
};

export type TurnoCatalogSyncRequest = {
  action: "SYNC";
  sources: TurnoCatalogSyncSource[];
  /** Explicit confirmation for registering the selected references in the company catalog. */
  confirm: true;
};

export type TurnoCatalogSyncResult = {
  entries: TurnoCatalogEntryDto[];
  createdCount: number;
  unchangedCount: number;
};

export type TurnoSwapRequest = {
  workspaceId: string;
  expectedRevision: number;
  employeeId: string;
  catalogCode: number;
  effectiveFrom: string;
  effectiveUntil: string;
};

export type TurnoSwapPreviewRequest = TurnoSwapRequest & { action: "PREVIEW_SWAP" };

export type TurnoSwapApplyRequest = TurnoSwapRequest & {
  action: "APPLY_SWAP";
  previewId: string;
  confirm: true;
};

export type TurnoSwapAffectedDayDto = {
  date: string;
  previousShiftId: string | null;
  previousCatalogCode: number | null;
  nextShiftId: string;
  nextCatalogCode: number;
};

export type TurnoSwapPreservedDayDto = {
  date: string;
  reason: "LOCKED" | "MANUAL" | "ABSENCE" | "OFF" | "HOLIDAY" | "NO_SHIFT";
};

export type TurnoSwapPreviewDto = {
  previewId: string;
  workspaceId: string;
  expectedRevision: number;
  employeeId: string;
  registration: string;
  target: TurnoCatalogEntryDto;
  affected: TurnoSwapAffectedDayDto[];
  preserved: TurnoSwapPreservedDayDto[];
  validationIssues: { code: string; message: string; date?: string }[];
  validationLevel: "FULL_SCHEDULE" | "NO_SCHEDULE";
  canApply: boolean;
};

export type TurnoExportSelection = {
  workspaceId: string;
  revision: number;
  /** One explicit local shift reference per employee; no schedule variant is inferred. */
  employees: { employeeId: string; localShiftId: string }[];
};

export type TurnoExportManifestRequest = {
  month: number;
  year: number;
  selections: TurnoExportSelection[];
};

export type TurnoExportOmissionDto = {
  workspaceId: string;
  employeeId: string;
  registration: string;
  reason: "NO_REFERENCE" | "MISSING" | "UNTIMED" | "CATALOG_REQUIRED" | "ZERO_MARKINGS" | "PARTIAL" | "OVERNIGHT" | "PAID_BREAK" | "TOO_MANY_PERIODS" | "DUPLICATE_REGISTRATION";
};

export type TurnoExportManifestDto = {
  manifestId: string;
  expiresAt: string;
  month: number;
  year: number;
  rowCount: number;
  omissions: TurnoExportOmissionDto[];
  formats: readonly ["TXT1", "TXT2"];
};
