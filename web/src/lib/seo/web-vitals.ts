import { prisma } from "@/lib/prisma";

export type VitalSummary = {
  metric: string;
  p75: number | null;
  samples: number;
  rating: "good" | "needs-improvement" | "poor" | "pending";
};

const THRESHOLDS: Record<string, [number, number]> = {
  CLS: [0.1, 0.25],
  FCP: [1_800, 3_000],
  INP: [200, 500],
  LCP: [2_500, 4_000],
  TTFB: [800, 1_800],
};

export function percentile75(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)] ?? null;
}

export function rateVital(metric: string, value: number | null): VitalSummary["rating"] {
  if (value === null) return "pending";
  const thresholds = THRESHOLDS[metric];
  if (!thresholds) return "pending";
  if (value <= thresholds[0]) return "good";
  if (value <= thresholds[1]) return "needs-improvement";
  return "poor";
}

export async function getWebVitalsSnapshot(days = 28) {
  const since = new Date(Date.now() - days * 86_400_000);
  const retention = new Date(Date.now() - 90 * 86_400_000);

  await prisma.seoWebVital.deleteMany({ where: { createdAt: { lt: retention } } });
  const samples = await prisma.seoWebVital.findMany({
    where: { createdAt: { gte: since } },
    select: { metric: true, value: true, path: true },
    orderBy: { createdAt: "desc" },
    take: 50_000,
  });

  const metrics = ["LCP", "INP", "CLS", "FCP", "TTFB"].map((metric) => {
    const values = samples
      .filter((sample) => sample.metric === metric)
      .map((sample) => sample.value);
    const p75 = percentile75(values);
    return { metric, p75, samples: values.length, rating: rateVital(metric, p75) };
  });

  const routeCounts = new Map<string, number>();
  for (const sample of samples) {
    routeCounts.set(sample.path, (routeCounts.get(sample.path) ?? 0) + 1);
  }

  return {
    days,
    metrics,
    totalSamples: samples.length,
    routes: [...routeCounts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
  };
}
