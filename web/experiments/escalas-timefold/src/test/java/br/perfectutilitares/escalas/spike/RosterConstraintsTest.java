package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.score.BendableScore;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class RosterConstraintsTest {
    private final ConstraintVerifier<RosterConstraints, Roster> verifier =
            ConstraintVerifier.build(new RosterConstraints(), Roster.class, Day.class);

    private static Day day(int index, Day.State state, Day.PatternKey key) {
        return new Day("person-0", "Sector 1", "Repositor", "clock", index,
                "2026-11-" + String.format("%02d", index + 1),
                List.of(new Day.Segment(420, 660), new Day.Segment(780, 1044)),
                false, false, null, state, key);
    }

    private static BendableScore score(long hard, long total, long sundays, long peak, long empty, long spread, long changes) {
        return BendableScore.of(new long[]{hard}, new long[]{total, sundays, peak, empty, spread, changes});
    }

    @Test void countsAnEntirelyEmptyWeek() {
        var window = new Roster.Window("person-0", 0, 6, 1, Day.State.WORK, 5, 5);
        verifier.verifyThat(RosterConstraints::emptyWindow)
                .given(window, day(0, Day.State.OFF, null)).penalizesBy(5);
    }
    @Test void rejectsSixConsecutiveWorkDays() {
        var window = new Roster.Window("person-0", 0, 5, 1, Day.State.WORK, 0, 5);
        verifier.verifyThat(RosterConstraints::windowCounts).given(window,
                day(0, Day.State.WORK, null), day(1, Day.State.WORK, null), day(2, Day.State.WORK, null),
                day(3, Day.State.WORK, null), day(4, Day.State.WORK, null), day(5, Day.State.WORK, null))
                .penalizesBy(1);
    }
    @Test void detectsRepeatedTwoWeekdays() {
        var p0 = new Day.PatternKey("person-0", 0, 2);
        var p1 = new Day.PatternKey("person-0", 1, 2);
        verifier.verifyThat(RosterConstraints::variableRestPattern)
                .given(day(0, Day.State.OFF, p0), day(7, Day.State.OFF, p0),
                        day(1, Day.State.OFF, p1), day(8, Day.State.OFF, p1)).penalizesBy(1);
    }
    @Test void emptyDemandAndMealGapAreNotIgnored() {
        var missing = new Roster.Band(0, "Missing sector", null, 480, 540, 2, false);
        var meal = new Roster.Band(0, "Sector 1", "Repositor", 660, 780, 1, true);
        verifier.verifyThat().given(missing, meal, day(0, Day.State.WORK, null))
                .scores(score(-120, -120, -120, -1, 0, 0, 0));
    }
    @Test void aDifferentRoleCannotSupplyCoverage() {
        var band = new Roster.Band(0, "Sector 1", "Caixa", 480, 540, 1, false);
        verifier.verifyThat().given(band, day(0, Day.State.WORK, null))
                .scores(score(-60, 0, 0, 0, 0, 0, 0));
    }
    @Test void supportedWorkSuppliesTheBand() {
        var band = new Roster.Band(0, "Sector 1", "Repositor", 480, 540, 1, true);
        verifier.verifyThat().given(band, day(0, Day.State.WORK, null))
                .scores(score(0, 0, 0, 0, 0, 0, 0));
    }
    @Test void generalAndRoleShortagesDoNotDoubleCount() {
        var band = new Roster.Band(0, "Sector 1", 480, 540, 2,
                Map.of("Caixa", 1, "Repositor", 1), true);
        verifier.verifyThat().given(band, day(0, Day.State.WORK, null))
                .scores(score(0, -60, -60, -1, 0, 0, 0));
        verifier.verifyThat().given(band, day(0, Day.State.OFF, null))
                .scores(score(0, -120, -120, -2, -1, 0, 0));
    }
    @Test void differentRoleFloorsCannotBeSatisfiedByTotalSurplus() {
        var band = new Roster.Band(0, "Sector 1", 480, 540, 1,
                Map.of("Caixa", 1, "Repositor", 1), false);
        Day first = day(0, Day.State.WORK, null);
        Day second = new Day("person-1", "Sector 1", "Repositor", "clock", 0, first.date(),
                first.getWorkSegments(), false, false, null, Day.State.WORK, null);
        verifier.verifyThat().given(band, first, second).scores(score(-60, 0, 0, 0, 0, 0, 0));
    }
    @Test void sundayIsPreferredWhenTotalDeficitTies() {
        var sun = new Roster.Band(0, "Sector 1", null, 480, 540, 1, true);
        var mon = new Roster.Band(1, "Sector 1", null, 480, 540, 1, true);
        var worksSunday = score(0, -60, 0, -1, -1, 0, 0);
        var restsSunday = score(0, -60, -60, -1, -1, 0, 0);
        verifier.verifyThat().given(sun, mon, day(0, Day.State.WORK, null), day(1, Day.State.OFF, null))
                .scores(worksSunday);
        verifier.verifyThat().given(sun, mon, day(0, Day.State.OFF, null), day(1, Day.State.WORK, null))
                .scores(restsSunday);
        assertTrue(worksSunday.compareTo(restsSunday) > 0);
        assertTrue(score(0, -59, -59, -100, -100, -100, -100).compareTo(worksSunday) > 0);
        assertTrue(score(-1, 0, 0, 0, 0, 0, 0).compareTo(restsSunday) < 0);
    }

    @Test void peakAndEmptyDayAreAggregatedWithoutDoubleCountingBands() {
        var band1 = new Roster.Band(1, "Sector 1", null, 480, 540, 2, true);
        var band2 = new Roster.Band(1, "Sector 1", null, 540, 600, 2, true);
        var band3 = new Roster.Band(2, "Sector 1", null, 480, 540, 1, true);
        verifier.verifyThat().given(band1, band2, band3, day(1, Day.State.OFF, null), day(2, Day.State.WORK, null))
                .scores(score(0, -240, 0, -2, -1, 0, 0));
    }

    @Test void sundaySpreadIncludesPersonWithNoWorkedSundays() {
        Day first = day(0, Day.State.WORK, null);
        Day second = new Day("person-1", "Sector 1", "Repositor", "clock", 0, first.date(),
                first.getWorkSegments(), false, false, null, Day.State.OFF, null);
        verifier.verifyThat().given(first, second).scores(score(0, 0, 0, 0, 0, -1, 0));
    }

    @Test void residualBudgetIsRoundedDownToMilliseconds() {
        var config = SpikeMain.config(Duration.ofNanos(1_234_567_891L));
        assertEquals(1234L, config.getTerminationConfig().calculateTimeMillisSpentLimit().longValue());
    }
    @Test void buildsAndSolvesWithPinnedDaysOnVersionTwo() {
        // A complete legal initial solution keeps this smoke independent of
        // stochastic convergence, while exercising real solver construction,
        // score calculation, planning IDs, field access and pinning.
        var cells = new ArrayList<Day>();
        for (int i = 0; i < 7; i++) {
            var state = i == 0 || i == 3 ? Day.State.OFF : Day.State.WORK;
            cells.add(new Day("person-0", "Sector 1", "Repositor", "clock", i,
                    "2026-11-" + String.format("%02d", i + 1),
                    List.of(new Day.Segment(420, 660), new Day.Segment(780, 1044)),
                    i == 0 || i == 6, i == 0 ? Boolean.TRUE : null,
                    state, state, null));
        }
        var windows = List.of(
                new Roster.Window("person-0", 0, 6, 1, Day.State.WORK, 5, 5),
                new Roster.Window("person-0", 0, 5, 1, Day.State.WORK, 0, 5),
                new Roster.Window("person-0", 1, 6, 1, Day.State.WORK, 0, 5));
        var bands = List.of(new Roster.Band(6, "Sector 1", "Repositor", 480, 540, 1, false));
        var result = SolverFactory.<Roster>create(SpikeMain.config(Duration.ofNanos(1_000_123_456L)))
                .buildSolver().solve(new Roster(cells, windows, bands));
        assertNotNull(result.score());
        assertTrue(result.score().isFeasible());
        assertEquals(7, result.days().size());
        assertEquals(5L, result.days().stream().filter(Day::working).count());
        assertTrue(result.days().stream().allMatch(day -> day.state() != null));
        assertEquals(Day.State.OFF, result.days().stream().filter(day -> day.index() == 0).findFirst().orElseThrow().state());
        assertEquals(Day.State.WORK, result.days().stream().filter(day -> day.index() == 6).findFirst().orElseThrow().state());
        assertEquals(windows, result.windows());
        assertEquals(bands, result.bands());
        assertEquals(List.of(Day.State.WORK, Day.State.OFF), result.getStates());
        for (Day solved : result.days()) {
            Day original = cells.get(solved.index());
            assertEquals(original.id(), solved.id());
            assertEquals(original.person(), solved.person());
            assertEquals(original.date(), solved.date());
            assertEquals(original.shift(), solved.shift());
            assertEquals(original.sector(), solved.sector());
            assertEquals(original.role(), solved.role());
            assertEquals(original.isPinned(), solved.isPinned());
            assertEquals(original.originalLocked(), solved.originalLocked());
            assertEquals(original.saved(), solved.saved());
            assertEquals(original.getWorkSegments(), solved.getWorkSegments());
        }
    }
}
