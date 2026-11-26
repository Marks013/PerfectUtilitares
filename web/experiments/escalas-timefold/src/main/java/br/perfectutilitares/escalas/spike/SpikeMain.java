package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.solver.SolverFactory;
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
        ObjectNode reply = JSON.createObjectNode();
        ObjectNode body = reply.putObject("body");
        reply.putNull("maxRssKiB"); // JVM heap is not RSS; cgroup counters are reported separately.
        int code = 200;
        String stage = "MAPPING";
        try {
            if (args.length > 1 || args.length == 1 && !args[0].equals("--pattern-seed"))
                throw new WireModel.Unsupported("SEED_ARGUMENT");
            boolean patternSeed = args.length == 1;
            byte[] bytes = System.in.readNBytes(LIMIT + 1);
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
                            start + Duration.ofSeconds(2).toNanos());
                    seedOutcome = PatternSeeder.seed(input, seedDeadline).name();
                    seedSeconds = elapsed(seedStart);
                }
                long initialized = input.days().stream().filter(day -> day.state() != null).count();
                long residual = BUDGET_NS - (System.nanoTime() - start);
                // No extra 12 seconds after mapping. Reserve a conservative setup/return margin.
                residual -= Duration.ofMillis(500).toNanos();
                Roster result = null;
                var firstFeasible = new AtomicLong(-1L);
                if (residual >= 1_000_000L) {
                    stage = "FACTORY";
                    var solver = SolverFactory.<Roster>create(config(Duration.ofMillis(residual / 1_000_000L))).buildSolver();
                    stage = "SEARCH";
                    solver.addEventListener(event -> {
                        if (event.getNewBestSolution().score() != null && event.getNewBestSolution().score().isFeasible()
                                && event.getNewBestSolution().days().stream().allMatch(day -> day.state() != null))
                            firstFeasible.compareAndSet(-1L, System.nanoTime() - start);
                    });
                    // Cooperative watchdog includes SolverFactory construction in the 12s deadline.
                    // Retry termination in case the first call preceded native solve startup.
                    var finished = new AtomicBoolean(false);
                    Thread watchdog = Thread.ofPlatform().daemon().name("e2-deadline").unstarted(() -> {
                        long stop = start + BUDGET_NS - Duration.ofMillis(250).toNanos();
                        while (!finished.get()) {
                            long remaining = stop - System.nanoTime();
                            if (remaining <= 0) {
                                solver.terminateEarly();
                                LockSupport.parkNanos(Duration.ofMillis(10).toNanos());
                            } else LockSupport.parkNanos(Math.min(remaining, Duration.ofMillis(50).toNanos()));
                        }
                    });
                    if (System.nanoTime() - start < BUDGET_NS - Duration.ofMillis(250).toNanos()) {
                        watchdog.start();
                        try { result = solver.solve(input); }
                        finally { finished.set(true); watchdog.interrupt(); }
                    }
                }
                stage = "RESULT";
                boolean valid = result != null && result.score() != null && result.score().isFeasible()
                        && result.days().size() == cells && result.days().stream().allMatch(day -> day.state() != null)
                        && System.nanoTime() - start <= BUDGET_NS;
                body.put("status", valid ? "FEASIBLE" : "UNKNOWN");
                body.put("message", valid ? "Synthetic E2 partial candidate" : "Synthetic E2 no feasible candidate within budget");
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
                telemetry.put("bands", input.bands().size());
                telemetry.put("windows", input.windows().size());
                if (firstFeasible.get() >= 0) telemetry.put("firstFeasibleSeconds", firstFeasible.get() / 1e9);
                else telemetry.putNull("firstFeasibleSeconds");
                telemetry.put("partialModel", true);
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
        if (code == 200 && body.path("status").asText().equals("FEASIBLE") && System.nanoTime() - start > BUDGET_NS) {
            body.put("status", "UNKNOWN");
            body.put("message", "Synthetic E2 result exceeded internal deadline");
            body.putArray("assignments");
            body.put("wallTimeSeconds", elapsed(start));
            output = JSON.writeValueAsBytes(reply);
        }
        if (output.length > LIMIT) {
            System.out.println("{\"httpStatus\":500,\"body\":{\"error\":\"SPIKE_OUTPUT_LIMIT\"},\"maxRssKiB\":null}");
        } else System.out.println(new String(output, java.nio.charset.StandardCharsets.UTF_8));
    }
}
