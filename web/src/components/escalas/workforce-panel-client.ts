import { z } from "zod";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";

const endpoint = "/api/escalas/workforce";
const revision = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const personSchema = z.object({
  branchCode: z.string().optional(),
  employee: z.object({
    registration: z.string().min(1), name: z.string(), sector: z.string(), role: z.string(),
    activeFrom: z.union([day, z.literal("")]).nullish(),
  }),
  listed: z.boolean().optional(),
  dismissedFrom: day.nullish(),
});
const absenceSchema = z.object({
  registration: z.string().min(1), startDate: day, endDate: day.nullable(), source: z.string(),
});
const snapshotSchema = z.object({
  revision, people: z.array(personSchema), absences: z.array(absenceSchema),
  catalogs: z.array(z.object({ branchCode: z.string().optional() })),
});
const mutationSchema = z.object({ revision, changed: z.boolean() });
const previewSchema = z.object({
  preview: z.object({
    revision,
    impactHash: z.string().min(1),
    rowCount: z.number().int().nonnegative(),
    openRowCount: z.number().int().nonnegative().optional(),
    branchCodes: z.array(z.string().min(1)).optional(),
    missingRegistrations: z.array(z.object({
      line: z.number().int().positive(), name: z.string().optional(), branchCode: z.string().optional(), resolved: z.boolean().optional(),
    })).optional(),
    canApply: z.boolean(),
    changed: z.boolean(),
  }),
});
const serverError = z.object({
  message: z.string().optional(),
  error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
});

export type WorkforceSnapshot = z.infer<typeof snapshotSchema>;
export type WorkforcePerson = z.infer<typeof personSchema>;
export type WorkforceAbsence = z.infer<typeof absenceSchema>;
export type WorkforceImportPreview = z.infer<typeof previewSchema>["preview"];
export type WorkforceImportPurpose = "EMPLOYEES" | "ABSENCES";
export type WorkforceRegistrationCorrection = { line: number; registration: string };
type PersonFields = { name: string; sector: string; role: string; activeFrom: string };
export type WorkforceChange =
  | ({ action: "CREATE_PERSON"; registration: string } & PersonFields)
  | ({ action: "UPDATE_PERSON"; registration: string } & Partial<PersonFields>)
  | { action: "SET_ABSENCE"; registration: string; startDate: string; endDate: string | null; previousStartDate?: string }
  | { action: "REMOVE_ABSENCE"; registration: string; startDate: string }
  | { action: "SET_RETURN_DATE"; registration: string; startDate: string; returnDate: string }
  | { action: "DISMISS_PERSON"; registration: string; dismissedFrom: string };

type ImportCommand = { purpose: WorkforceImportPurpose; registrationCorrections?: WorkforceRegistrationCorrection[] } & (
  | { action: "IMPORT_PREVIEW" }
  | { action: "IMPORT_APPLY"; expectedRevision: number; impactHash: string }
);

async function request<T>(schema: z.ZodType<T>, url: string, signal: AbortSignal, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, signal, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = serverError.safeParse(payload);
    const detail = problem.success ? typeof problem.data.error === "string"
      ? problem.data.error : problem.data.error?.message ?? problem.data.message : undefined;
    throw new Error(detail || (response.status === 409
      ? "A base mudou. Atualize a filial e confira novamente antes de salvar."
      : "Não foi possível concluir a ação na base de pessoal."));
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error("A resposta da base de pessoal não pôde ser conferida.");
  return parsed.data;
}

export async function readWorkforce(branchCode: string, signal: AbortSignal) {
  const selected = canonicalBranchCode(branchCode);
  const snapshot = await request(snapshotSchema, `${endpoint}?${new URLSearchParams({ branchCode: selected })}`, signal);
  const isOutside = (entry: { branchCode?: string }) => entry.branchCode !== undefined && entry.branchCode !== selected;
  const registrations = new Set(snapshot.people.map(entry => entry.employee.registration));
  if (snapshot.people.some(isOutside) || snapshot.catalogs.some(isOutside)
    || snapshot.absences.some(entry => !registrations.has(entry.registration))) {
    throw new Error("A resposta não corresponde à filial selecionada.");
  }
  return snapshot;
}

export function changeWorkforce(branchCode: string, expectedRevision: number, command: WorkforceChange, signal: AbortSignal) {
  return request(mutationSchema, endpoint, signal, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command, branchCode, expectedRevision }),
  });
}

function importOptions(file: File, command: ImportCommand): RequestInit {
  const body = new FormData();
  body.set("file", file);
  body.set("command", JSON.stringify(command));
  return { method: "POST", body };
}

export async function previewWorkforceImport(file: File, purpose: WorkforceImportPurpose, registrationCorrections: WorkforceRegistrationCorrection[], signal: AbortSignal) {
  const result = await request(previewSchema, endpoint, signal, importOptions(file, {
    action: "IMPORT_PREVIEW", purpose, ...(registrationCorrections.length ? { registrationCorrections } : {}),
  }));
  return result.preview;
}

export function applyWorkforceImport(file: File, purpose: WorkforceImportPurpose, registrationCorrections: WorkforceRegistrationCorrection[], preview: WorkforceImportPreview, signal: AbortSignal) {
  if (!preview.changed || !preview.canApply || preview.missingRegistrations?.some(row => !row.resolved)) {
    throw new Error("Confira o arquivo e as matrículas antes de confirmar a importação.");
  }
  return request(mutationSchema, endpoint, signal, importOptions(file, {
    action: "IMPORT_APPLY", purpose, expectedRevision: preview.revision, impactHash: preview.impactHash,
    ...(registrationCorrections.length ? { registrationCorrections } : {}),
  }));
}
