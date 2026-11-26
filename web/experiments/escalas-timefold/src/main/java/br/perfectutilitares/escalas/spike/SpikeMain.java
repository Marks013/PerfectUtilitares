package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.solver.SolverManager;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.score.BendableScore;
import ai.timefold.solver.core.config.solver.SolverManagerConfig;
import ai.timefold.solver.core.config.solver.SolverConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;

/** Single request over stdin/stdout. No HTTP, persistent state, secrets or production use. */
public final class SpikeMain {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int LIMIT = 8 * 1024 * 1024;
    private static final long BUDGET_NS = Duration.ofSeconds(12).toNanos();

    private static double elapsed(long start) { return (System.nanoTime() - start) / 1e9; }

    static SolverConfig config(Duration budget) {
        return new SolverConfig().withSolutionClass(Roster.class).withEntityClasses(Day.class)
                .withConstraintProviderClass(RosterConstraints.class).withRandomSeed(37L)
                .withTerminationSpentLimit(Duration.ofMillis(budget.toMillis())); // Timefold 2.8 rejects sub-microsecond durations.
    }

    public static void main(String[] args) throws Exception {
        long start = System.nanoTime();
        boolean pattern = false, warm = false, seedOnly = false, stagnation = false, weeklySwap = false;
        Integer budgetSeconds = null;
        for (String arg : args) {
            if (arg.equals("--pattern-seed") && !pattern) pattern = true;
            else if (arg.equals("--warm-batch") && !warm) warm = true;
            else if (arg.equals("--seed-only") && !seedOnly) seedOnly = true;
            else if (arg.equals("--stagnation-1s") && !stagnation) stagnation = true;
            else if (arg.equals("--weekly-swap") && !weeklySwap) weeklySwap = true;
            else if (budgetSeconds == null && arg.matches("--budget-seconds=(2|4|8|12)"))
                budgetSeconds = Integer.parseInt(arg.substring("--budget-seconds=".length()));
            else {
                System.out.println("{\"httpStatus\":400,\"body\":{\"error\":\"SPIKE_UNSUPPORTED_INPUT\",\"failureType\":\"SEED_ARGUMENT\"},\"maxRssKiB\":null}");
                return;
            }
        }
        if (seedOnly && (!pattern || warm) || (budgetSeconds != null || stagnation || weeklySwap) && (!pattern || warm || seedOnly)) {
            System.out.println("{\"httpStatus\":400,\"body\":{\"error\":\"SPIKE_UNSUPPORTED_INPUT\",\"failureType\":\"SEED_ARGUMENT\"},\"maxRssKiB\":null}");
            return;
        }
        // Warm mode repeats exactly the same bounded synthetic envelope in
        // one JVM, with fresh domain and solver manager on every invocation.
        byte[] bytes = System.in.readNBytes(LIMIT + 1);
        int repeats = warm ? 3 : 1;
        long budgetNs = budgetSeconds == null ? BUDGET_NS : Duration.ofSeconds(budgetSeconds).toNanos();
        for (int i = 0; i < repeats; i++) {
            System.out.println(solveOne(bytes, pattern, seedOnly, stagnation, weeklySwap, budgetNs, i == 0 ? start : System.nanoTime()));
        }
    }

    private static String solveOne(byte[] bytes, boolean patternSeed, boolean seedOnly, boolean stagnation, boolean weeklySwap, long budgetNs, long start) throws Exception {
        ObjectNode reply = JSON.createObjectNode();
        ObjectNode body = reply.putObject("body");
        reply.putNull("maxRssKiB"); // JVM heap is not RSS; cgroup counters are reported separately.
        int code = 200;
        String stage = "MAPPING";
        try {
            if (bytes.length > LIMIT) {
                code = 413;
                body.put("error", "SPIKE_INPUT_LIMIT");
            } else {
                Roster input = WireModel.read(JSON.readTree(bytes));
                int cells = input.days().size();
                long beforeSeed = input.days().stream().filter(day -> day.state() != null).count();
                double mappingSeconds = elapsed(start);
                String seedOutcome = "NOT_REQUESTED";
                double seedSeconds = 0;
                if (patternSeed) {
                    stage = "SEED";
                    long seedStart = System.nanoTime();
                    long seedDeadline = Math.min(seedStart + Duration.ofMillis(1250).toNanos(),
                            Math.min(start + Duration.ofSeconds(2).toNanos(), start + budgetNs - Duration.ofMillis(500).toNanos()));
                    seedOutcome = PatternSeeder.seed(input, seedDeadline).name();
                    seedSeconds = elapsed(seedStart);
                }
                boolean guarded = seedOutcome.equals("APPLIED") && SeedGuard.install(input);
                long initialized = input.days().stream().filter(day -> day.state() != null).count();
                long residual = budgetNs - (System.nanoTime() - start);
                // No extra 12 seconds after mapping. Reserve a conservative setup/return margin.
                residual -= Duration.ofMillis(500).toNanos();
                Roster result = null;
                var firstFeasible = new AtomicLong(-1L);
                long calculations = 0, moves = 0;
                double solvingSeconds = 0;
                boolean weeklySwapApplied = false;
                BendableScore seedScore = null;
                // Specialized local search requires a fully initialized legal seed.
                // Use a fresh score director before selecting a local-search-only phase.
                if (weeklySwap && guarded && residual >= 1_000_000L) {
                    stage = "FACTORY";
                    var checker=SolutionManager.<Roster,BendableScore>create(
                            SolverFactory.<Roster>create(config(Duration.ofMillis(residual/1_000_000L))));
                    seedScore=checker.update(input);
                    weeklySwapApplied=seedScore!=null && seedScore.isFeasible() && seedScore.softScore(0)==0L
                            && input.days().stream().allMatch(day -> day.state()!=null);
                    residual=budgetNs-(System.nanoTime()-start)-Duration.ofMillis(500).toNanos();
                }

                if (seedOnly) {
                    // Diagnostic control only. Validate the identical seed with
                    // the real incremental scoring model, but run no local search.
                    if (guarded && residual >= 1_000_000L) {
                        stage = "FACTORY";
                        var factory = SolverFactory.<Roster>create(config(Duration.ofMillis(residual / 1_000_000L)));
                        var validator = SolutionManager.<Roster, BendableScore>create(factory);
                        var score = validator.update(input);
                        if (score != null && score.isFeasible() && score.softScore(0) == 0L) {
                            result = input;
                            calculations = 1;
                            firstFeasible.set(System.nanoTime() - start);
                        }
                    }
                } else if (residual >= 1_000_000L) {
                    stage = "FACTORY";
                    var searchConfig = config(Duration.ofMillis(residual / 1_000_000L));
                    // Diagnostic only: do not stop an unguarded construction on a
                    // stagnation criterion, and do not change the normal 12s path.
                    if (stagnation && guarded) searchConfig.withTerminationUnimprovedSpentLimit(Duration.ofSeconds(1));
                    if (weeklySwapApplied) WeeklySwapSearch.configure(searchConfig);
                    try (var manager = SolverManager.<Roster>create(searchConfig,
                            new SolverManagerConfig().withParallelSolverCount("1"))) {
                        stage = "SEARCH";
                        if (System.nanoTime() - start < budgetNs - Duration.ofMillis(250).toNanos()) {
                            var job = manager.solveBuilder().withProblemId("synthetic-e2").withProblem(input)
                                    .withBestSolutionEventConsumer(event -> {
                                        var solution = event.solution();
                                        if (solution.score() != null && solution.score().isFeasible()
                                                && solution.days().stream().allMatch(day -> day.state() != null))
                                            firstFeasible.compareAndSet(-1L, System.nanoTime() - start);
                                    }).withExceptionHandler((id, error) -> {
                                        // getFinalBestSolution propagates failure; never log a payload.
                                    }).run();
                            var finished = new AtomicBoolean(false);
                            Thread watchdog = Thread.ofPlatform().daemon().name("e2-deadline").unstarted(() -> {
                                long stop = start + budgetNs - Duration.ofMillis(250).toNanos();
                                while (!finished.get()) {
                                    long remaining = stop - System.nanoTime();
                                    if (remaining <= 0) {
                                        job.terminateEarly();
                                        return;
                                    }
                                    LockSupport.parkNanos(Math.min(remaining, Duration.ofMillis(50).toNanos()));
                                }
                            });
                            watchdog.start();
                            try {
                                result = job.getFinalBestSolution();
                                calculations = job.getScoreCalculationCount();
                                moves = job.getMoveEvaluationCount();
                                solvingSeconds = job.getSolvingDuration().toMillis() / 1000.0;
                            } finally {
                                finished.set(true);
                                watchdog.interrupt();
                            }
                        }
                    }
                }
                stage = "RESULT";
                // Snapshot once after manager closure. An asynchronous consumer
                // may omit intermediate events, so distinguish the final fallback.
                long firstTime = firstFeasible.get();
                String firstSource = firstTime >= 0 ? (seedOnly ? "VALIDATED_SEED" : "DELIVERED_EVENT") : "NONE";
                boolean completeFeasible = result != null && result.score() != null && result.score().isFeasible()
                        && result.days().size() == cells && result.days().stream().allMatch(day -> day.state() != null);
                if (completeFeasible && firstTime < 0) {
                    firstTime = System.nanoTime() - start;
                    firstSource = "FINAL_FALLBACK";
                }
                Long guardViolation = guarded && result != null && result.score() != null
                        ? Math.max(0L, -result.score().softScore(0)) : null;
                boolean valid = completeFeasible && (!guarded || guardViolation != null && guardViolation == 0L)
                        && System.nanoTime() - start <= budgetNs;
                body.put("status", valid ? "FEASIBLE" : "UNKNOWN");
                body.put("message", valid ? (seedOnly ? "Synthetic E2 constructor-only diagnostic" : "Synthetic E2 partial candidate")
                        : "Synthetic E2 no feasible candidate within budget");
                var assignments = body.putArray("assignments");
                if (valid) for (Day day : result.days()) {
                    ObjectNode row = assignments.addObject();
                    row.put("employeeId", day.person()); row.put("date", day.date());
                    row.put("kind", day.state().name());
                    if (day.working()) row.put("shiftId", day.shift());
                    if (day.originalLocked() != null) row.put("locked", day.originalLocked());
                }
                body.put("wallTimeSeconds", elapsed(start));
                var telemetry = reply.putObject("spike");
                telemetry.put("mappingSeconds", mappingSeconds);
                telemetry.put("entities", cells);
                telemetry.put("initialized", initialized);
                telemetry.put("beforeSeed", beforeSeed);
                telemetry.put("seedMode", patternSeed ? "PATTERN" : "DEFAULT");
                telemetry.put("seedOutcome", seedOutcome);
                telemetry.put("seedSeconds", seedSeconds);
                telemetry.put("guardedSeed", guarded);
                telemetry.put("seedOnly", seedOnly);
                if (guardViolation == null) telemetry.putNull("seedGuardViolation");
                else telemetry.put("seedGuardViolation", guardViolation);
                telemetry.put("scoreCalculations", calculations);
                telemetry.put("moveEvaluations", moves);
                telemetry.put("solvingSeconds", solvingSeconds);
                telemetry.put("firstFeasibleSource", firstSource);
                telemetry.put("bands", input.bands().size());
                telemetry.put("windows", input.windows().size());
                if (firstTime >= 0) telemetry.put("firstFeasibleSeconds", firstTime / 1e9);
                else telemetry.putNull("firstFeasibleSeconds");
                telemetry.put("partialModel", true);
                telemetry.put("budgetSeconds", budgetNs / 1_000_000_000L);
                telemetry.put("stagnationRequested", stagnation);
                telemetry.put("stagnationApplied", stagnation && guarded && !seedOnly && residual >= 1_000_000L);
                telemetry.put("weeklySwapRequested", weeklySwap);
                telemetry.put("weeklySwapApplied", weeklySwapApplied);
                telemetry.put("weeklySwapScoreImproved", weeklySwapApplied && result != null && result.score() != null
                        && seedScore != null && result.score().compareTo(seedScore) > 0);
            }
        } catch (WireModel.Unsupported | java.time.DateTimeException | ArithmeticException error) {
            code = 400;
            body.removeAll();
            body.put("error", "SPIKE_UNSUPPORTED_INPUT");
            body.put("failureStage", stage);
            if (error instanceof WireModel.Unsupported && error.getMessage().matches("[A-Z_]{1,60}")) body.put("failureType", error.getMessage());
        } catch (Exception | LinkageError error) {
            code = 500;
            body.removeAll();
            body.put("error", "SPIKE_FAILED");
            body.put("failureStage", stage);
            String type = error.getClass().getSimpleName();
            body.put("failureType", type.matches("[A-Za-z0-9]{1,64}") ? type : "InternalError");
        }
        reply.put("httpStatus", code);
        reply.set("cgroup", CgroupSample.read(JSON, Path.of("/sys/fs/cgroup")));
        // Error and proof texts are fixed; do not serialize stack traces, the input or internal scores.
        byte[] output = JSON.writeValueAsBytes(reply);
        if (code == 200 && body.path("status").asText().equals("FEASIBLE") && System.nanoTime() - start > budgetNs) {
            body.put("status", "UNKNOWN");
            body.put("message", "Synthetic E2 result exceeded internal deadline");
            body.putArray("assignments");
            body.put("wallTimeSeconds", elapsed(start));
            output = JSON.writeValueAsBytes(reply);
        }
        if (output.length > LIMIT) {
            return "{\"httpStatus\":500,\"body\":{\"error\":\"SPIKE_OUTPUT_LIMIT\"},\"maxRssKiB\":null}";
        }
        return new String(output, java.nio.charset.StandardCharsets.UTF_8);
    }
}
