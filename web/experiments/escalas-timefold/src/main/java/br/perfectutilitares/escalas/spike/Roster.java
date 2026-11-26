package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.BendableScore;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    /** One disjoint sector/date/type slice; role and general minima are not additive. */
    public record Band(int day, String sector, int start, int end, int generalMinimum,
                       Map<String, Integer> roleMinima, boolean estimated, int minimum) {
        public Band {
            roleMinima = Map.copyOf(roleMinima);
            if (start < 0 || end <= start || generalMinimum < 0
                    || minimum != totalMinimum(generalMinimum, roleMinima)) {
                throw new IllegalArgumentException("INVALID_BAND");
            }
        }
        public Band(int day, String sector, int start, int end, int generalMinimum,
                    Map<String, Integer> roleMinima, boolean estimated) {
            this(day, sector, start, end, generalMinimum, roleMinima, estimated,
                    totalMinimum(generalMinimum, roleMinima));
        }
        private static int totalMinimum(int general, Map<String, Integer> roles) {
            int sum = 0;
            for (int floor : roles.values()) {
                if (floor < 0) throw new IllegalArgumentException("INVALID_ROLE_FLOOR");
                sum = Math.addExact(sum, floor);
            }
            return Math.max(general, sum);
        }
        // Convenience constructor for isolated single-floor tests.
        public Band(int day, String sector, String role, int start, int end, int minimum, boolean estimated) {
            this(day, sector, start, end, role == null ? minimum : 0,
                    role == null ? Map.of() : Map.of(role, minimum), estimated);
        }
        public boolean matches(Day item) {
            return item.working() && item.covers(start, end);
        }
        public long missing(long count, Map<String, Set<String>> roleMembers) {
            long roleGap = 0;
            for (var floor : roleMinima.entrySet()) {
                Set<String> members = roleMembers.get(floor.getKey());
                roleGap += Math.max(0, floor.getValue() - (members == null ? 0 : members.size()));
            }
            return (long) (end - start) * Math.max(Math.max(0, minimum() - count), roleGap);
        }
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
    @PlanningScore(bendableHardLevelsSize = 1, bendableSoftLevelsSize = RosterConstraints.SOFT_LEVELS)
    private BendableScore score;

    public Roster() {}
    Roster(List<Day> days, List<Window> windows, List<Band> bands) {
        this.days = new ArrayList<>(days);
        this.windows = List.copyOf(windows);
        this.bands = List.copyOf(bands);
    }
    // Public JavaBean accessors for every private planning-annotated field.
    // Collections of facts remain immutable; only planning entities and
    // the score are mutable during the solve.
    public List<Day.State> getStates() { return states; }
    public void setStates(List<Day.State> states) { this.states = List.copyOf(states); }
    public List<Window> getWindows() { return windows; }
    public void setWindows(List<Window> windows) { this.windows = List.copyOf(windows); }
    public List<Band> getBands() { return bands; }
    public void setBands(List<Band> bands) { this.bands = List.copyOf(bands); }
    public List<Day> getDays() { return days; }
    public void setDays(List<Day> days) { this.days = days; }
    public BendableScore getScore() { return score; }
    public void setScore(BendableScore score) { this.score = score; }

    public List<Day> days() { return getDays(); }
    public List<Window> windows() { return getWindows(); }
    public List<Band> bands() { return getBands(); }
    public BendableScore score() { return getScore(); }
}
