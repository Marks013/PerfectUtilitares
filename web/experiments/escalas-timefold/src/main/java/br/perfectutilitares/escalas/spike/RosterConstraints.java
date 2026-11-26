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
    record SundayGroup(String sector, int cap) {}
    record SectorPerson(SundayGroup group, String person) {}
    record SundayDate(SundayGroup group, int day) {}
    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        var estimated = deficits(factory, true);
        return new Constraint[] {
            windowCounts(factory), emptyWindow(factory), variableRestPattern(factory),
            confirmedCoverage(factory), totalEstimatedCoverage(estimated),
            sundayCoverage(estimated), sectorPeak(estimated), dailyService(factory),
            sundaySpread(factory), sundayDateSpread(factory), changes(factory)
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
        var present = bands.join(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches));
        var general = present.filter((band, day) -> band.roleMinima().isEmpty())
                .groupBy((band, day) -> band, countBi())
                .map((band, count) -> band, (band, count) -> band.missing(count, Map.of()));
        var roles = present.filter((band, day) -> !band.roleMinima().isEmpty())
                .groupBy((band, day) -> band, countBi(), toMap((band, day) -> day.role(), (band, day) -> day.id()))
                .map((band, count, members) -> band, (band, count, members) -> band.missing(count, members));
        return general.concat(roles)
                .concat(bands.ifNotExists(Day.class, equal(Roster.Band::day, Day::index),
                        equal(Roster.Band::sector, Day::sector), filtering(Roster.Band::matches)),
                        band -> band.missing(0, Map.of()));
    }

    Constraint confirmedCoverage(ConstraintFactory f) {
        return deficits(f, false).filter((band, gap) -> gap > 0)
                .penalize(HARD, (band, gap) -> gap).asConstraint("Confirmed coverage");
    }

    Constraint totalEstimatedCoverage(BiConstraintStream<Roster.Band, Long> estimated) {
        return estimated.filter((band, gap) -> gap > 0)
                .penalize(level(0), (band, gap) -> gap).asConstraint("Estimated coverage total");
    }

    // Only the admitted Sunday-based horizon. Not a general calendar rule.
    Constraint sundayCoverage(BiConstraintStream<Roster.Band, Long> estimated) {
        return estimated.filter((band, gap) -> band.day() % 7 == 0 && gap > 0)
                .penalize(level(1), (band, gap) -> gap).asConstraint("Sunday estimated coverage");
    }

    Constraint sectorPeak(BiConstraintStream<Roster.Band, Long> estimated) {
        return estimated
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

    private static SundayGroup sundayGroup(Day day) {
        return new SundayGroup(day.sector(), day.getSundayCap());
    }
    private static long rate(long worked, long opportunities) {
        return worked * 10_000L / opportunities;
    }
    private Constraint spread(BiConstraintStream<SundayGroup, Long> rates, String name) {
        return rates.groupBy((group, value) -> group,
                        ConstraintCollectors.<SundayGroup, Long, Long>min((group, value) -> value),
                        ConstraintCollectors.<SundayGroup, Long, Long>max((group, value) -> value))
                .filter((group, low, high) -> high > low)
                .penalize(level(4), (group, low, high) -> high - low).asConstraint(name);
    }
    Constraint sundaySpread(ConstraintFactory f) {
        // Include unassigned opportunities during construction; exclude imposed OFF.
        BiConstraintStream<SundayGroup, Long> rates = f.forEachIncludingUnassigned(Day.class).filter(Day::sundayOpportunity)
                .groupBy(day -> new SectorPerson(sundayGroup(day), day.person()),
                        sum(day -> day.working() ? 1L : 0L), count())
                .map((person, worked, available) -> person.group(),
                        (person, worked, available) -> rate(worked, available));
        return spread(rates, "Sunday personal rate spread");
    }
    Constraint sundayDateSpread(ConstraintFactory f) {
        BiConstraintStream<SundayGroup, Long> rates = f.forEachIncludingUnassigned(Day.class).filter(Day::sundayOpportunity)
                .groupBy(day -> new SundayDate(sundayGroup(day), day.index()),
                        sum(day -> day.working() ? 1L : 0L), count())
                .map((date, worked, available) -> date.group(),
                        (date, worked, available) -> rate(worked, available));
        // Same rate scale and objective level as personal spread, not a presence guard.
        return spread(rates, "Sunday date rate spread");
    }

    Constraint changes(ConstraintFactory f) {
        return f.forEach(Day.class).filter(day -> day.saved() != null && day.state() != day.saved())
                .penalize(level(5))
                .asConstraint("Changes to saved day");
    }
}
