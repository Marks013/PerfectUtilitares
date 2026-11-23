import { prisma } from "@/lib/prisma";
import { EscalaError, type EscalaActor } from "./access";
import { type admitCandidateReference, selectCandidateReference } from "./candidate-reference.server";
import { admitDecemberOriginReference } from "./december-origin-reference";
import { isDecember2026Cutover } from "./planning-calendar";
import { alignPersistedCoverageTarget, compareRosterCoverage, preservesAdmittedDecemberCoverage } from "./roster-quality";
import { escalaInputSchema } from "./schema";
import type { solveEscala } from "./solver-client";
import type { EscalaInput } from "./types";

type Admission = ReturnType<typeof admitCandidateReference>;
type Calculation = Awaited<ReturnType<typeof solveEscala>>;

async function loadDecemberOrigin(actor: EscalaActor, id: string, saved: EscalaInput, context: EscalaInput, currentApprovalVerified: boolean) {
  const origin = saved.planningCalendarSource;
  if (!origin) return undefined;
  const row = await prisma.escalaWorkspace.findFirst({
    where: { id: origin.workspaceId, tenantId: actor.tenantId, branchCode: saved.branchCode },
    select: { id: true, tenantId: true, branchCode: true },
  });
  if (row && row.id !== id && row.id === origin.workspaceId && row.tenantId === actor.tenantId && row.branchCode === saved.branchCode) {
    const version = await prisma.escalaRevision.findUnique({ where: {
      tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: row.id, revision: origin.revision },
    } });
    // A verified approval on the current draft permits internal use of its pinned legacy origin.
    if (version?.revision === origin.revision && (actor.admin || version.approvedPolicyVersionId || currentApprovalVerified)) {
      const source = escalaInputSchema.safeParse(version.input);
      if (source.success) return admitDecemberOriginReference(source.data, saved, context);
    }
  }
  throw new EscalaError(409, "ESCALA_DECEMBER_ORIGIN_UNAVAILABLE",
    "A revisão de origem deste rascunho está indisponível. Confira a escala original antes de gerar dezembro.");
}

export async function prepareDecemberCoverage(actor: EscalaActor, id: string, saved: EscalaInput, context: EscalaInput, currentApprovalVerified: boolean) {
  if (!isDecember2026Cutover(context)) return { contextual: context };
  const aligned = alignPersistedCoverageTarget(saved, context);
  if (aligned !== context || !saved.needsRegeneration) return { contextual: aligned };
  const origin = await loadDecemberOrigin(actor, id, saved, context, currentApprovalVerified);
  return { origin, contextual: origin ? { ...context, demands: origin.demands, coverageBasis: origin.coverageBasis } : context };
}

export function admitDecemberCandidate(admitted: Admission, origin?: EscalaInput): Admission {
  if (!origin || !admitted.input || meetsOrigin(origin, admitted.input)) return admitted;
  return { comparison: { admission: "INCOMPATIBLE", selection: "NOT_USED", reason: "FROZEN_COVERAGE_REGRESSION" } };
}

export async function calculateWithDecemberFallback(
  solve: Promise<Calculation>, reference?: EscalaInput,
): Promise<{ calculation: Calculation; retainedReference: boolean }> {
  try {
    return { calculation: await solve, retainedReference: false };
  } catch (error) {
    if (!reference || !(error instanceof EscalaError) || error.code !== "ESCALA_FROZEN_COVERAGE_REGRESSION") throw error;
    return { retainedReference: true, calculation: { status: "FEASIBLE", assignments: reference.assignments, wallTimeSeconds: 0,
      message: "A proposta anterior verificada preserva a cobertura de dezembro." } };
  }
}

export function selectDecemberCandidate(admitted: Admission, candidate: EscalaInput, saved: EscalaInput, origin?: EscalaInput, retainedReference = false) {
  if (!origin) return selectCandidateReference(admitted, candidate, saved);
  if (!retainedReference && meetsOrigin(origin, candidate)) return selectCandidateReference(admitted, candidate, origin, "DECEMBER_DEMAND");
  if (admitted.input) return { input: admitted.input, comparison: { ...admitted.comparison,
    selection: "REFERENCE_RETAINED" as const, reason: "FROZEN_COVERAGE_REGRESSION" } };
  throw new EscalaError(422, "ESCALA_FROZEN_COVERAGE_REGRESSION",
    "A proposta perdeu cobertura em relação à referência de dezembro. O rascunho salvo foi preservado.");
}

function meetsOrigin(origin: EscalaInput, candidate: EscalaInput): boolean {
  return preservesAdmittedDecemberCoverage(compareRosterCoverage(origin, candidate, origin, "DECEMBER_DEMAND"));
}
