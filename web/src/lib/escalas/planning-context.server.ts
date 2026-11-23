import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { type EscalaActor, EscalaError } from "./access";
import { preserveCalendarSourceContext } from "./calendar-upgrade";
import { preservePublishedDays, publishedPlanningContext } from "./continuity";
import { addDays } from "./dates";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

export async function planningContext(actor: EscalaActor, id: string, input: EscalaInput, db: Prisma.TransactionClient = prisma) {
  const rows = await db.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, branchCode: input.branchCode, id: { not: id }, startDate: { lte: addDays(input.endDate, 21) }, endDate: { gte: addDays(input.startDate, -21) } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { revisions: { where: { tenantId: actor.tenantId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  const published: EscalaInput[] = [];
  for (const row of rows) {
    const revision = row.revisions?.[0];
    if (!revision) continue;
    const parsed = escalaInputSchema.safeParse(revision.input);
    if (!parsed.success) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Uma proposta publicada da filial não pôde ser conferida.");
    published.push(parsed.data);
  }
  return preserveCalendarSourceContext(input, preservePublishedDays(publishedPlanningContext(input, published), published));
}
