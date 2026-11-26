package br.perfectutilitares.escalas.spike;

import java.util.*;

/** Frozen operational ceilings derived from the Timefold constructor alone.
 * Only the admitted fixed-clock E2 domain. Never declare estimated demand hard.
 */
final class SeedGuard {
    private SeedGuard() {}
    private record Key(String sector, int day) {}
    static boolean install(Roster roster) {
        if (roster.days().stream().anyMatch(day -> day.state() == null)) return false;
        var people = new HashMap<String, List<Day>>();
        var attended = new LinkedHashMap<Key, List<Day>>();
        for (Day day : roster.days()) {
            people.computeIfAbsent(day.person(), k -> new ArrayList<>()).add(day);
            if (day.working()) attended.computeIfAbsent(new Key(day.sector(), day.index()), k -> new ArrayList<>()).add(day);
        }
        for (var window : roster.windows()) {
            long count = people.getOrDefault(window.person(), List.of()).stream().filter(window::matches).count();
            if (window.violation(count) != 0) return false;
        }
        var patternCounts = new HashMap<Day.PatternKey, Integer>();
        for (Day day : roster.days()) if (day.resting() && day.patternKey() != null)
            patternCounts.merge(day.patternKey(), 1, Integer::sum);
        var repeated = new HashMap<String, Integer>();
        for (var entry : patternCounts.entrySet()) if (entry.getValue() == entry.getKey().weeks()
                && repeated.merge(entry.getKey().person(), 1, Integer::sum) > 1) return false;
        var sectors = new TreeMap<String, long[]>();
        for (Day day : roster.days()) sectors.computeIfAbsent(day.sector(), k -> new long[3]);
        for (var band : roster.bands()) {
            var members = new HashMap<String, Set<String>>();
            int count = 0;
            for (Day day : attended.getOrDefault(new Key(band.sector(), band.day()), List.of())) if (band.matches(day)) {
                count++;
                members.computeIfAbsent(day.role(), k -> new HashSet<>()).add(day.id());
            }
            long gap = band.missing(count, members);
            if (!band.estimated()) {
                if (gap != 0) return false;
                continue;
            }
            long[] values = sectors.computeIfAbsent(band.sector(), k -> new long[3]);
            values[0] += gap;
            if (band.day() % 7 == 0) values[1] += gap;
            values[2] = Math.max(values[2], gap / (band.end() - band.start()));
        }
        roster.setSectorLimits(sectors.entrySet().stream()
                .map(e -> new Roster.SectorLimit(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2])).toList());
        roster.setServiceLimits(attended.keySet().stream().map(key -> new Roster.ServiceLimit(key.sector(), key.day())).toList());
        return true;
    }
}
