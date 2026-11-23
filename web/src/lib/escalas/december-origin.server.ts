import { prisma } from "@/lib/prisma";
import { EscalaError, type EscalaActor } from "./access";
import { admitDecemberOriginReference } from "./december-origin-reference";
import { isDecember2026Cutover } from "./planning-calendar";
import { alignPersistedCoverageTarget } from "./roster-quality";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

async function loadDecemberOrigin(actor: EscalaActor, id: string, saved: EscalaInput, context: EscalaInput) {
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
    if (version?.revision === origin.revision && (actor.admin || version.approvedPolicyVersionId)) {
      const source = escalaInputSchema.safeParse(version.input);
      if (source.success) return admitDecemberOriginReference(source.data, saved, context);
    }
  }
  throw new EscalaError(409, "ESCALA_DECEMBER_ORIGIN_UNAVAILABLE",
    "A revisão de origem deste rascunho está indisponível. Confira a escala original antes de gerar dezembro.");
}

export async function prepareDecemberCoverage(actor: EscalaActor, id: string, saved: EscalaInput, context: EscalaInput) {
  if (!isDecember2026Cutover(context)) return { contextual: context };
  const aligned = alignPersistedCoverageTarget(saved, context);
  if (aligned !== context || !saved.needsRegeneration) return { contextual: aligned };
  const origin = await loadDecemberOrigin(actor, id, saved, context);
  return { origin, contextual: origin ? { ...context, demands: origin.demands, coverageBasis: origin.coverageBasis } : context };
}
