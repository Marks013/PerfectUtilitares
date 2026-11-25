package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.score.BendableScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.count;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.countBi;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.toMap;
import java.util.Map;
import ai.timefold.solver.core.api.score.stream.bi.BiConstraintStream;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.sum;
import static ai.timefold.solver.core.api.score.stream.Joiners.equal;
import static ai.timefold.solver.core.api.score.stream.Joiners.filtering;

/** E2 only: incremental fixed-clock model; NOT the full PerfectUtilitares priority policy. */
public class RosterConstraints implements ConstraintProvider {
    public static final int SOFT_LEVELS = 6;
    private static final BendableScore HARD = BendableScore.ofHard(1, SOFT_LEVELS, 0, 1L);
    private static BendableScore level(int index) {
        return BendableScore.ofSoft(1, SOFT_LEVELS, index, 1L);
    }
    record SectorDay(String sector, int day) {}
    record SectorPerson(String sector, String person) {}
    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[] {
            windowCounts(factory), emptyWindow(factory), variableRestPattern(factory),
            confirmedCoverage(factory), totalEstimatedCoverage(factory),
            sundayCoverage(factory), sectorPeak(factory), dailyService(factory),
            sundaySpread(factory), changes(factory)
        };
    }

    Constraint windowCounts(ConstraintFactory f) {
        return f.forEach(Roster.Window.class)
                .join(Day.class, equal(Roster.Window::person, Day::person),
                        filtering(Roster.Window::matches))
                .groupBy((window, day) -> window, countBi())
                .filter((window, count) -> window.violation(count) > 0)
                .penalize(HARD, (window, count) -> window.violation(count))
                .asConstraint("Window count bounds");
    }

    Constraint emptyWindow(ConstraintFactory f) {
        return f.forEach(Roster.Window.class).filter(window -> window.min() > 0)
                .ifNotExists(Day.class, equal(Roster.Window::person, Day::person),
                        filtering(Roster.Window::matches))
                .penalize(HARD, window -> window.violation(0))
                .asConstraint("Window with no matches");
    }

    Constraint variableRestPattern(ConstraintFactory f) {
        return f.forEach(Day.class).filter(day -> day.resting() && day.patternKey() != null)
                .groupBy(Day::patternKey, count())
                .filter((key, count) -> count == key.weeks())
                .groupBy((key, count) -> key.person(), countBi())
                .filter((person, count) -> count > 1)
                .penalize(HARD, (person, count) -> count - 1)
                .asConstraint("Variable weekly pattern must vary");
    }

    /** One gap per disjoint band, including a band with no WORK member. */
    private BiConstraintStream<Roster.Band, Long> deficits(ConstraintFactory f, boolean estimated) {
        var bands = f.forEach(Roster.Band.class).filter(b -> b.estimated() == estimated && b.minimum() > 0);
        return bands.join(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches))
                .groupBy((band, day) -> band, countBi(), toMap((band, day) -> day.role(), (band, day) -> day.id()))
                .map((band, count, members) -> band, (band, count, members) -> band.missing(count, members))
                .concat(bands.ifNotExists(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches)),
                        band -> band.missing(0, Map.of()));
    }

    Constraint confirmedCoverage(ConstraintFactory f) {
        return deficits(f, false).filter((band, gap) -> gap > 0)
                .penalize(HARD, (band, gap) -> gap).asConstraint("Confirmed coverage");
    }

    Constraint totalEstimatedCoverage(ConstraintFactory f) {
        return deficits(f, true).filter((band, gap) -> gap > 0)
                .penalize(level(0), (band, gap) -> gap).asConstraint("Estimated coverage total");
    }

    // Only the admitted Sunday-based horizon. Not a general calendar rule.
    Constraint sundayCoverage(ConstraintFactory f) {
        return deficits(f, true).filter((band, gap) -> band.day() % 7 == 0 && gap > 0)
                .penalize(level(1), (band, gap) -> gap).asConstraint("Sunday estimated coverage");
    }

    Constraint sectorPeak(ConstraintFactory f) {
        return deficits(f, true)
                .groupBy((band, gap) -> band.sector(),
                        ConstraintCollectors.<Roster.Band, Long, Long>max(
                                (band, gap) -> gap / (band.end() - band.start())))
                .filter((sector, peak) -> peak > 0)
                .penalize(level(2), (sector, peak) -> peak).asConstraint("Sector peak shortage");
    }

    Constraint dailyService(ConstraintFactory f) {
        return f.forEach(Roster.Band.class).filter(b -> b.estimated() && b.minimum() > 0)
                .groupBy(b -> new SectorDay(b.sector(), b.day()))
                .ifNotExists(Day.class, equal(SectorDay::sector, Day::sector),
                        equal(SectorDay::day, Day::index), filtering((key, day) -> day.working()))
                .penalize(level(3)).asConstraint("Demanded sector day without service");
    }

    Constraint sundaySpread(ConstraintFactory f) {
        // All admitted people have equal complete horizons. Include zero WORK counts.
        return f.forEach(Day.class).filter(day -> day.index() % 7 == 0)
                .groupBy(day -> new SectorPerson(day.sector(), day.person()),
                        sum(day -> day.working() ? 1L : 0L))
                .groupBy((person, count) -> person.sector(),
                        ConstraintCollectors.<SectorPerson, Long, Long>min((person, count) -> count),
                        ConstraintCollectors.<SectorPerson, Long, Long>max((person, count) -> count))
                .filter((sector, low, high) -> high > low)
                .penalize(level(4), (sector, low, high) -> high - low).asConstraint("Sunday sector spread");
    }

    Constraint changes(ConstraintFactory f) {
        return f.forEach(Day.class).filter(day -> day.saved() != null && day.state() != day.saved())
                .penalize(level(5))
                .asConstraint("Changes to saved day");
    }
}
