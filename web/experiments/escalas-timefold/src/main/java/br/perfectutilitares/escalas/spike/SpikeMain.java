package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
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
                .withTerminationSpentLimit(budget);
    }

    public static void main(String[] args) throws Exception {
        long start = System.nanoTime();
        ObjectNode reply = JSON.createObjectNode();
        ObjectNode body = reply.putObject("body");
        reply.putNull("maxRssKiB"); // JVM heap is not RSS; external cgroup/RSS measurement is pending.
        int code = 200;
        try {
            byte[] bytes = System.in.readNBytes(LIMIT + 1);
            if (bytes.length > LIMIT) {
                code = 413;
                body.put("error", "SPIKE_INPUT_LIMIT");
            } else {
                Roster input = WireModel.read(JSON.readTree(bytes));
                int cells = input.days().size();
                long initialized = input.days().stream().filter(day -> day.state() != null).count();
                double mappingSeconds = elapsed(start);
                long residual = BUDGET_NS - (System.nanoTime() - start);
                // No extra 12 seconds after mapping. Reserve a conservative setup/return margin.
                residual -= Duration.ofMillis(500).toNanos();
                Roster result = null;
                var firstFeasible = new AtomicLong(-1L);
                if (residual > 0) {
                    var solver = SolverFactory.<Roster>create(config(Duration.ofNanos(residual))).buildSolver();
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
                body.put("wallTimeSeconds", Math.min(60.0, elapsed(start)));
                var telemetry = reply.putObject("spike");
                telemetry.put("mappingSeconds", mappingSeconds);
                telemetry.put("entities", cells);
                telemetry.put("initialized", initialized);
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
        } catch (Exception error) {
            code = 500;
            body.removeAll();
            body.put("error", "SPIKE_FAILED");
            System.err.println("E2 internal failure: " + error.getClass().getSimpleName());
        }
        reply.put("httpStatus", code);
        // Error and proof texts are fixed; do not serialize stack traces, the input or internal scores.
        byte[] output = JSON.writeValueAsBytes(reply);
        if (output.length > LIMIT) {
            System.out.println("{\"httpStatus\":500,\"body\":{\"error\":\"SPIKE_OUTPUT_LIMIT\"},\"maxRssKiB\":null}");
        } else System.out.println(new String(output, java.nio.charset.StandardCharsets.UTF_8));
    }
}
