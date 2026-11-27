import { z } from "zod";

const scopes = {
  COVERAGE: "SCOPED",
  SUNDAY_COVERAGE: "SCOPED",
  SUNDAY_PEAK: "PARTIAL_GLOBAL_BOUND",
  MOVEMENT_COVERAGE: "SCOPED",
  CLOSING_COVERAGE: "SCOPED",
  UNTIMED_ROTATION: "SCOPED_WEEKDAY_AND_SUNDAY",
  SUNDAY_BALANCE: "SCOPED_COHORT_AND_DATES",
  REST_SPACING: "SCOPED_MONTHLY_EXCESS_AND_PAIRS",
  LEADERSHIP: "SCOPED_EXPLICIT_RESPONSIBILITY",
  SATURDAY_BALANCE: "SCOPED_COHORT",
  REST_DISTRIBUTION: "SCOPED_SECTOR_ROLE_AND_LEADERS",
  REST_ROTATION: "SCOPED",
  PEOPLE_CHANGED: "SCOPED",
  STABILITY: "SCOPED",
  PREFERENCES: "SCOPED",
  TIE_BREAK: "SCOPED_ORIGINAL_SHA256",
} as const;

const seconds = z.number().finite().min(0).max(60);

/** These are score levels of one bounded search, not independent CP-SAT phases. */
export const solverForgeOptimizationSchema = z.strictObject({
  engine: z.literal("SolverForge"),
  version: z.literal(1),
  method: z.literal("BOUNDED_LEXICOGRAPHIC_SEARCH"),
  globalOptimalityProven: z.literal(false),
  partialModel: z.literal(true),
  constructionSeconds: seconds,
  feasibilitySeconds: seconds,
  refinementSeconds: seconds,
  stopReason: z.literal("BOUNDED_REFINEMENT"),
  nativeSearchAttempted: z.boolean(),
  nativeCandidateAccepted: z.boolean(),
  leadership: z.strictObject({
    criticalSectorDaysWithoutLeader: z.number().int().min(0).max(10500),
    timedCoverageIncluded: z.literal(false),
  }).optional(),
  phases: z.array(z.strictObject({
    objective: z.enum(Object.keys(scopes) as [keyof typeof scopes, ...(keyof typeof scopes)[]]),
    scope: z.string(),
    execution: z.literal("LEXICOGRAPHIC_SCORE_LEVEL"),
    status: z.literal("FEASIBLE"),
    proven: z.literal(false),
    initialValue: z.number().int(),
    incumbentValue: z.number().int(),
  }).refine(level => scopes[level.objective] === level.scope, {
    path: ["scope"], message: "Escopo incompatível com o nível de pontuação",
  })).min(1).max(Object.keys(scopes).length),
}).superRefine((value, context) => {
  if (value.nativeCandidateAccepted && !value.nativeSearchAttempted) {
    context.addIssue({ code: "custom", path: ["nativeCandidateAccepted"], message: "Não houve busca nativa" });
  }
  if (new Set(value.phases.map(level => level.objective)).size !== value.phases.length) {
    context.addIssue({ code: "custom", path: ["phases"], message: "Níveis de pontuação duplicados" });
  }
});

export type SolverForgeOptimization = z.infer<typeof solverForgeOptimizationSchema>;
