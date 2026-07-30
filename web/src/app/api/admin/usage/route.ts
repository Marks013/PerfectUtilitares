import { NextResponse } from "next/server";
import { z } from "zod";
import { methodNotAllowed, requireAdmin } from "@/lib/api/security";
import { prisma } from "@/lib/prisma";
import {
  getUsagePeriodRange,
  type UsagePeriod,
} from "@/lib/usage/period";

export const runtime = "nodejs";

const querySchema = z.object({
  period: z.enum(["day", "month", "year"]).default("day"),
});

const emptyModules = () => ({
  JORNADA: 0,
  FOTOS: 0,
  PDF: 0,
});

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    period: url.searchParams.get("period") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_PERIOD", message: "Período de uso inválido." } },
      { status: 400 },
    );
  }

  const period: UsagePeriod = parsed.data.period;
  const { start, end } = getUsagePeriodRange(period);
  const [users, totals] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        tenant: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.userUsageDaily.groupBy({
      by: ["userId", "module"],
      where: { date: { gte: start, lt: end } },
      _sum: { count: true, inputBytes: true, outputBytes: true },
    }),
  ]);

  const usageByUser = new Map<
    string,
    {
      total: number;
      modules: ReturnType<typeof emptyModules>;
      inputBytes: bigint;
      outputBytes: bigint;
    }
  >();

  for (const item of totals) {
    const current = usageByUser.get(item.userId) ?? {
      total: 0,
      modules: emptyModules(),
      inputBytes: 0n,
      outputBytes: 0n,
    };
    const count = item._sum.count ?? 0;
    current.total += count;
    current.modules[item.module] += count;
    current.inputBytes += item._sum.inputBytes ?? 0n;
    current.outputBytes += item._sum.outputBytes ?? 0n;
    usageByUser.set(item.userId, current);
  }

  return NextResponse.json({
    period,
    start: start.toISOString().slice(0, 10),
    endExclusive: end.toISOString().slice(0, 10),
    users: users.map((user) => {
      const usage = usageByUser.get(user.id) ?? {
        total: 0,
        modules: emptyModules(),
        inputBytes: 0n,
        outputBytes: 0n,
      };

      return {
        ...user,
        total: usage.total,
        modules: usage.modules,
        inputBytes: usage.inputBytes.toString(),
        outputBytes: usage.outputBytes.toString(),
      };
    }),
  });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function PATCH() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
