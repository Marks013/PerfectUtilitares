package br.perfectutilitares.escalas.spike;

import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class PatternSeederTest {
    private Roster roster() {
        var days = new ArrayList<Day>();
        var windows = new ArrayList<Roster.Window>();
        var bands = new ArrayList<Roster.Band>();
        for (int i = 0; i < 28; i++)
            bands.add(new Roster.Band(i, "S", null, 480, 540, 1, true));
        for (int p = 0; p < 3; p++) {
            String id = "person-" + p;
            for (int week = 0; week < 4; week++)
                windows.add(new Roster.Window(id, week * 7, week * 7 + 6, 1, Day.State.WORK, 5, 5));
            for (int i = 0; i + 5 < 28; i++)
                windows.add(new Roster.Window(id, i, i + 5, 1, Day.State.WORK, 0, 5));
            for (int i = 0; i + 2 < 28; i++)
                windows.add(new Roster.Window(id, i, i + 2, 1, Day.State.OFF, 0, 2));
            for (int week = 0; week < 3; week++)
                windows.add(new Roster.Window(id, week * 7, (week + 1) * 7, 7, Day.State.WORK, 0, 1));
            for (int i = 0; i < 28; i++) {
                boolean lock = p == 0 && i == 0;
                boolean sat = i % 7 == 6;
                days.add(new Day(id, "S", "Repositor", "clock", i, LocalDate.of(2026, 11, 1).plusDays(i).toString(),
                        List.of(new Day.Segment(420, 660), new Day.Segment(780, 1044)), lock || sat,
                        lock ? Boolean.TRUE : null, lock ? Day.State.OFF : null,
                        lock ? Day.State.OFF : sat ? Day.State.WORK : null,
                        new Day.PatternKey(id, i % 7, 4)));
            }
        }
        return new Roster(days, windows, bands);
    }

    @Test void completePersonalPatternsRespectPinsAndAllModelWindows() {
        Roster roster = roster();
        assertEquals(PatternSeeder.Outcome.APPLIED, PatternSeeder.seed(roster, Long.MAX_VALUE));
        assertTrue(roster.days().stream().allMatch(day -> day.state() != null));
        assertEquals(Day.State.OFF, roster.days().getFirst().state());
        assertTrue(roster.days().stream().filter(day -> day.index() % 7 == 6).allMatch(Day::working));
        for (var window : roster.windows()) {
            long count = roster.days().stream().filter(day -> day.person().equals(window.person()) && window.matches(day)).count();
            assertEquals(0, window.violation(count));
        }
        for (String person : List.of("person-0", "person-1", "person-2")) {
            long repeated = java.util.stream.IntStream.range(0, 7).filter(weekday ->
                    roster.days().stream().filter(day -> day.person().equals(person) && day.index() % 7 == weekday).allMatch(Day::resting)).count();
            assertTrue(repeated <= 1);
        }
        // No rewriting of a complete seed (including repair inputs).
        var before = roster.days().stream().map(Day::state).toList();
        assertEquals(PatternSeeder.Outcome.COMPLETE, PatternSeeder.seed(roster, Long.MAX_VALUE));
        assertEquals(before, roster.days().stream().map(Day::state).toList());
    }

    @Test void twoPeopleCanCoverAllDatesWithoutImportingAnIncumbent() {
        Roster original = roster();
        var days = original.days().stream().filter(d -> !d.person().equals("person-2")).toList();
        var windows = original.windows().stream().filter(w -> !w.person().equals("person-2")).toList();
        // No estimated demand on day 17. Presence still matters on that day.
        var bands = original.bands().stream().filter(b -> b.day() != 17).toList();
        Roster two = new Roster(days, windows, bands);
        assertEquals(PatternSeeder.Outcome.APPLIED, PatternSeeder.seed(two, Long.MAX_VALUE));
        for (int i = 0; i < 28; i++) {
            final int day = i;
            assertTrue(two.days().stream().anyMatch(d -> d.index() == day && d.working()), "day " + i);
        }
        for (var window : two.windows()) assertEquals(0, window.violation(two.days().stream()
                .filter(d -> d.person().equals(window.person()) && window.matches(d)).count()));
        assertEquals(Day.State.OFF, two.days().getFirst().state());
    }

    @Test void constructorCanBeValidatedByTheRealScoreWithoutLocalSearch() {
        Roster roster = roster();
        assertEquals(PatternSeeder.Outcome.APPLIED, PatternSeeder.seed(roster, Long.MAX_VALUE));
        assertTrue(SeedGuard.install(roster));
        var before = roster.days().stream().map(Day::state).toList();
        var factory = ai.timefold.solver.core.api.solver.SolverFactory.<Roster>create(
                SpikeMain.config(java.time.Duration.ofSeconds(1)));
        var validator = ai.timefold.solver.core.api.solver.SolutionManager
                .<Roster, ai.timefold.solver.core.api.score.BendableScore>create(factory);
        var score = validator.update(roster);
        assertNotNull(score);
        assertEquals(score, roster.score());
        assertTrue(score.isFeasible());
        assertEquals(0L, score.softScore(0));
        assertEquals(before, roster.days().stream().map(Day::state).toList());
    }

    @Test void expiredBudgetLeavesAllCellsUntouched() {
        Roster roster = roster();
        var before = roster.days().stream().map(Day::state).toList();
        assertEquals(PatternSeeder.Outcome.TIME_LIMIT, PatternSeeder.seed(roster, System.nanoTime() - 1));
        assertEquals(before, roster.days().stream().map(Day::state).toList());
    }

    @Test void impossiblePinnedWeekDoesNotPartiallyInitializeOtherPeople() {
        Roster roster = roster();
        for (Day day : roster.days()) if (day.person().equals("person-2") && day.index() < 6) {
            day.setPinned(true); day.setState(Day.State.OFF);
        }
        var before = roster.days().stream().map(Day::state).toList();
        assertEquals(PatternSeeder.Outcome.NO_PATTERN, PatternSeeder.seed(roster, Long.MAX_VALUE));
        assertEquals(before, roster.days().stream().map(Day::state).toList());
    }
}
