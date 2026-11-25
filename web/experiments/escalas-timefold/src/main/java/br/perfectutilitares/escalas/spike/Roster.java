package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import java.util.ArrayList;
import java.util.List;

@PlanningSolution
public class Roster {
    /** Window count rules are immutable facts. step=7 represents Sunday streaks. */
    public record Window(String person, int first, int last, int step, Day.State state, int min, int max) {
        public boolean matches(Day day) {
            return day.index() >= first && day.index() <= last
                    && (day.index() - first) % step == 0 && day.state() == state;
        }
        public long violation(long count) { return Math.max(0, min - count) + Math.max(0, count - max); }
    }
    /** A civil half-open interval split at every eligible WORK segment edge. */
    public record Band(int day, String sector, String role, int start, int end, int minimum, boolean estimated) {
        public boolean matches(Day item) {
            return item.working() && (role == null || role.equals(item.role())) && item.covers(start, end);
        }
        public long missing(long count) { return (long) (end - start) * Math.max(0, minimum - count); }
    }

    @ValueRangeProvider(id = "states")
    @ProblemFactCollectionProperty
    private List<Day.State> states = List.of(Day.State.WORK, Day.State.OFF);
    @ProblemFactCollectionProperty
    private List<Window> windows;
    @ProblemFactCollectionProperty
    private List<Band> bands;
    @PlanningEntityCollectionProperty
    private List<Day> days;
    @PlanningScore
    private HardMediumSoftScore score;

    public Roster() {}
    Roster(List<Day> days, List<Window> windows, List<Band> bands) {
        this.days = new ArrayList<>(days);
        this.windows = List.copyOf(windows);
        this.bands = List.copyOf(bands);
    }
    public List<Day> days() { return days; }
    public List<Window> windows() { return windows; }
    public List<Band> bands() { return bands; }
    public HardMediumSoftScore score() { return score; }
}
