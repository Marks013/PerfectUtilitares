package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.count;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.countBi;
import static ai.timefold.solver.core.api.score.stream.Joiners.equal;
import static ai.timefold.solver.core.api.score.stream.Joiners.filtering;

/** E2 only: incremental fixed-clock model; NOT the full PerfectUtilitares priority policy. */
public class RosterConstraints implements ConstraintProvider {
    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[] {
            windowCounts(factory), emptyWindow(factory), variableRestPattern(factory),
            coverage(factory, false), emptyCoverage(factory, false),
            coverage(factory, true), emptyCoverage(factory, true), changes(factory)
        };
    }

    Constraint windowCounts(ConstraintFactory f) {
        return f.forEach(Roster.Window.class)
                .join(Day.class, equal(Roster.Window::person, Day::person),
                        filtering(Roster.Window::matches))
                .groupBy((window, day) -> window, countBi())
                .filter((window, count) -> window.violation(count) > 0)
                .penalize(HardMediumSoftScore.ONE_HARD, (window, count) -> window.violation(count))
                .asConstraint("Window count bounds");
    }

    Constraint emptyWindow(ConstraintFactory f) {
        return f.forEach(Roster.Window.class).filter(window -> window.min() > 0)
                .ifNotExists(Day.class, equal(Roster.Window::person, Day::person),
                        filtering(Roster.Window::matches))
                .penalize(HardMediumSoftScore.ONE_HARD, window -> window.violation(0))
                .asConstraint("Window with no matches");
    }

    Constraint variableRestPattern(ConstraintFactory f) {
        return f.forEach(Day.class).filter(day -> day.resting() && day.patternKey() != null)
                .groupBy(Day::patternKey, count())
                .filter((key, count) -> count == key.weeks())
                .groupBy((key, count) -> key.person(), countBi())
                .filter((person, count) -> count > 1)
                .penalize(HardMediumSoftScore.ONE_HARD, (person, count) -> count - 1)
                .asConstraint("Variable weekly pattern must vary");
    }

    Constraint coverage(ConstraintFactory f, boolean estimated) {
        return f.forEach(Roster.Band.class).filter(band -> band.estimated() == estimated)
                .join(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches))
                .groupBy((band, day) -> band, countBi())
                .filter((band, count) -> band.missing(count) > 0)
                .penalize(estimated ? HardMediumSoftScore.ONE_MEDIUM : HardMediumSoftScore.ONE_HARD,
                        (band, count) -> band.missing(count))
                .asConstraint(estimated ? "Estimated coverage" : "Confirmed coverage");
    }

    Constraint emptyCoverage(ConstraintFactory f, boolean estimated) {
        return f.forEach(Roster.Band.class).filter(band -> band.estimated() == estimated && band.minimum() > 0)
                .ifNotExists(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches))
                .penalize(estimated ? HardMediumSoftScore.ONE_MEDIUM : HardMediumSoftScore.ONE_HARD,
                        band -> band.missing(0))
                .asConstraint(estimated ? "Estimated coverage without service" : "Confirmed coverage without service");
    }

    Constraint changes(ConstraintFactory f) {
        return f.forEach(Day.class).filter(day -> day.saved() != null && day.state() != day.saved())
                .penalize(HardMediumSoftScore.ONE_SOFT)
                .asConstraint("Changes to saved day");
    }
}
