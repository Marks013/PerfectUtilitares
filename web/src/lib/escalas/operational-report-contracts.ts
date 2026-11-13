import { z } from "zod";

export const OPERATIONAL_REPORT_PATH = "/api/escalas/operational-report";
export const OPERATIONAL_REPORT_METHOD = "GET";
export const OPERATIONAL_REPORT_CONTENT_TYPE = "application/pdf";
export const OPERATIONAL_REPORT_SECTIONS = ["summary", "calendar", "journeys", "variants", "presence", "coverage"] as const;
export type OperationalReportSection = typeof OPERATIONAL_REPORT_SECTIONS[number];
export type OperationalReportGenerationMode = "REST_ONLY" | "DAYS_AND_HOURS" | "HOURS_ONLY";
export const OPERATIONAL_REPORT_SECTION_LABELS: Readonly<Record<OperationalReportSection, string>> = {
  summary: "Resumo mensal", calendar: "Calendário mensal", journeys: "Jornadas e turnos",
  variants: "Catálogo de variantes", presence: "Mapa diário por horário", coverage: "Cobertura por faixa",
};
// UI preferences only: presets resolve to sections, never to assignments or saved settings.
export const OPERATIONAL_REPORT_PRESETS = {
  monthly: { label: "Planejamento mensal", sections: ["summary", "calendar", "journeys"] },
  day: { label: "Conferir um dia", sections: ["presence", "coverage"] },
  references: { label: "Referências de horários", sections: ["journeys", "variants"] },
} as const satisfies Record<string, { label: string; sections: readonly OperationalReportSection[] }>;

const civilMonth = /^20\d{2}-(0[1-9]|1[0-2])$/;
function isCivilDate(value: string): boolean {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
const identifier = z.string().min(1).max(100).refine(value => value.trim() === value && !Array.from(value).some(character => { const code = character.charCodeAt(0); return code <= 0x1f || code === 0x7f; }), "Identificação inválida");
const sector = z.string().min(1).max(120).refine(value => value.trim().length > 0 && !Array.from(value).some(character => { const code = character.charCodeAt(0); return code <= 0x1f || code === 0x7f; }), "Setor inválido");

export const operationalReportOptionsSchema = z.object({
  workspaceId: identifier,
  revision: z.number().int().min(1).max(2_000_000_000),
  // The visible civil month, never inferred from the technical horizon's startDate.
  month: z.string().regex(civilMonth),
  format: z.literal("pdf").default("pdf"),
  sections: z.array(z.enum(OPERATIONAL_REPORT_SECTIONS)).min(1).max(6),
  sectors: z.array(sector).max(100).default([]),
  date: z.string().refine(isCivilDate, "Data civil inválida").optional(),
}).strict().superRefine((value, context) => {
  if (value.date && value.date.slice(0, 7) !== value.month) context.addIssue({ code: "custom", path: ["date"], message: "Selecione uma data do mês visível" });
  if (value.sections.includes("presence") && !value.date) context.addIssue({ code: "custom", path: ["date"], message: "Selecione a data do mapa diário" });
}).transform(value => ({ ...value,
  sections: OPERATIONAL_REPORT_SECTIONS.filter(section => value.sections.includes(section)),
  sectors: [...new Set(value.sectors)].sort(),
}));
export type OperationalReportOptions = z.output<typeof operationalReportOptionsSchema>;

/** Repeated section/sector keys are lists; repeated scalar keys and unknown keys are errors. */
export function parseOperationalReportQuery(params: URLSearchParams) {
  const scalar = (key: string) => { const values = params.getAll(key); return values.length > 1 ? values : values[0]; };
  const revision = scalar("revision");
  const input: Record<string, unknown> = {
    workspaceId: scalar("workspaceId"), revision: typeof revision === "string" && /^[1-9]\d*$/.test(revision) ? Number(revision) : revision,
    month: scalar("month"), format: scalar("format"), date: scalar("date"),
    sections: params.getAll("section"), sectors: params.getAll("sector"),
  };
  const known = new Set(["workspaceId", "revision", "month", "format", "date", "section", "sector"]);
  for (const key of params.keys()) if (!known.has(key)) return operationalReportOptionsSchema.safeParse({ ...input, unknownQueryParameter: key });
  return operationalReportOptionsSchema.safeParse(input);
}

/** Pure serializer; callers trigger navigation/download explicitly. No fetch, save or generation. */
export function serializeOperationalReportQuery(options: z.input<typeof operationalReportOptionsSchema>): string {
  const value = operationalReportOptionsSchema.parse(options);
  const params = new URLSearchParams({ workspaceId: value.workspaceId, revision: String(value.revision), month: value.month, format: value.format });
  for (const section of value.sections) params.append("section", section);
  for (const sector of value.sectors) params.append("sector", sector);
  if (value.date) params.set("date", value.date);
  return params.toString();
}

export function operationalReportCapabilities(generationMode: OperationalReportGenerationMode, hasRoster: boolean) {
  return { generationMode, referencesOnly: !hasRoster,
    sections: hasRoster ? [...OPERATIONAL_REPORT_SECTIONS] : ["journeys", "variants"] as OperationalReportSection[] };
}
export type OperationalReportContext = {
  workspaceId: string; revision: number; visibleMonth: string;
  generationMode: OperationalReportGenerationMode;
  /** Derived by the caller from the canonical roster/reference-only contract, not assignment count alone. */
  hasRoster: boolean; sectors: readonly string[];
};
export type OperationalReportSelectionIssue = { field: "workspaceId" | "revision" | "month" | "sections" | "sectors"; message: string };

/** UI preflight and server validation share this rule; it does not replace tenant authorization. */
export function validateOperationalReportSelection(options: OperationalReportOptions, context: OperationalReportContext): OperationalReportSelectionIssue[] {
  const issues: OperationalReportSelectionIssue[] = [];
  if (options.workspaceId !== context.workspaceId) issues.push({ field: "workspaceId", message: "Selecione a grade atual" });
  if (options.revision !== context.revision) issues.push({ field: "revision", message: "A revisão selecionada mudou" });
  if (options.month !== context.visibleMonth) issues.push({ field: "month", message: "Use o mês visível da grade selecionada" });
  const allowed = operationalReportCapabilities(context.generationMode, context.hasRoster).sections;
  if (options.sections.some(section => !allowed.includes(section))) issues.push({ field: "sections", message: "Sem grade, selecione somente referências de jornadas ou variantes" });
  if (options.sectors.some(sector => !context.sectors.includes(sector))) issues.push({ field: "sectors", message: "Selecione setores da grade atual" });
  return issues;
}
