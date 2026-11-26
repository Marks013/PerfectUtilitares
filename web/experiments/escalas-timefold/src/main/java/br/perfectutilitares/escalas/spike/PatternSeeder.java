package br.perfectutilitares.escalas.spike;

import java.util.*;

/** Bounded optional E2 experiment. Initialize daily decisions using legal
 * per-person weekly masks, without using a CP-SAT output or relaxing pins.
 * Collective hard coverage is not proved by the greedy constructor.
 * A timeout or unsupported shape leaves the original roster untouched.
 */
final class PatternSeeder {
    enum Outcome { APPLIED, COMPLETE, TIME_LIMIT, NO_PATTERN, UNSUPPORTED }
    private record Rule(int bits, boolean work, int min, int max) {
        boolean allows(int mask) {
            int count = Integer.bitCount((work ? mask : ~mask) & bits);
            return count >= min && count <= max;
        }
    }
    private record PatternRule(int bits, int weeks) {}
    private record Shape(int days, int pinnedWork, int pinnedOff,
                         List<Rule> rules, List<PatternRule> patterns) {
        boolean allows(int mask) {
            if ((mask & pinnedWork) != pinnedWork || (mask & pinnedOff) != 0) return false;
            for (Rule rule : rules) if (!rule.allows(mask)) return false;
            int common = 0;
            for (PatternRule pattern : patterns)
                if (Integer.bitCount(~mask & pattern.bits()) == pattern.weeks() && ++common > 1) return false;
            return true;
        }
    }
    private record Rank(long hard, long total, long sunday, long service, long balance, long stability)
            implements Comparable<Rank> {
        @Override public int compareTo(Rank other) {
            int c = Long.compare(hard, other.hard);
            if (c != 0) return c;
            c = Long.compare(total, other.total);
            if (c != 0) return c;
            c = Long.compare(sunday, other.sunday);
            if (c != 0) return c;
            c = Long.compare(service, other.service);
            if (c != 0) return c;
            c = Long.compare(balance, other.balance);
            return c != 0 ? c : Long.compare(stability, other.stability);
        }
    }

    private static final int[] WEEK_MASKS = java.util.stream.IntStream.range(0, 128)
            .filter(mask -> (mask & 64) != 0 && Integer.bitCount(mask) == 5).toArray();

    private static Shape shape(List<Day> days, List<Roster.Window> windows) {
        int length = days.size(), pinnedWork = 0, pinnedOff = 0;
        if (length != 7 && length != 28) return null;
        var grouped = new LinkedHashMap<Day.PatternKey, Integer>();
        for (int i = 0; i < length; i++) {
            Day day = days.get(i);
            if (day.index() != i) return null;
            if (day.isPinned()) {
                if (day.state() == null) return null;
                if (day.working()) pinnedWork |= 1 << i;
                else pinnedOff |= 1 << i;
            }
            if (day.patternKey() != null) grouped.merge(day.patternKey(), 1 << i, (a, b) -> a | b);
        }
        var rules = new ArrayList<Rule>();
        for (Roster.Window window : windows) {
            if (window.first() < 0 || window.last() >= length || window.first() > window.last()
                    || window.step() < 1 || window.state() == null || window.min() < 0
                    || window.max() < window.min()) return null;
            int bits = 0;
            for (int day = window.first(); day <= window.last(); day += window.step()) bits |= 1 << day;
            rules.add(new Rule(bits, window.state() == Day.State.WORK, window.min(), window.max()));
        }
        var patterns = new ArrayList<PatternRule>();
        for (var entry : grouped.entrySet()) {
            if (Integer.bitCount(entry.getValue()) != entry.getKey().weeks()) return null;
            patterns.add(new PatternRule(entry.getValue(), entry.getKey().weeks()));
        }
        return new Shape(length, pinnedWork, pinnedOff, List.copyOf(rules), List.copyOf(patterns));
    }

    private static boolean enumerate(Shape shape, int offset, int mask, List<Integer> result, long deadline) {
        if (System.nanoTime() >= deadline) return false;
        if (offset == shape.days()) {
            if (shape.allows(mask)) result.add(mask);
            return true;
        }
        int weekBits = 127 << offset;
        for (int week : WEEK_MASKS) {
            int shifted = week << offset;
            if ((shifted & shape.pinnedWork() & weekBits) != (shape.pinnedWork() & weekBits)
                    || (shifted & shape.pinnedOff()) != 0) continue;
            if (!enumerate(shape, offset + 7, mask | shifted, result, deadline)) return false;
        }
        return true;
    }

    private static final class BandState {
        final Roster.Band band;
        int present;
        final Map<String, Integer> roles = new HashMap<>();
        BandState(Roster.Band band) { this.band = band; }
        long gap(String addedRole) {
            long roleGap = 0;
            for (var floor : band.roleMinima().entrySet()) {
                int count = roles.getOrDefault(floor.getKey(), 0);
                if (floor.getKey().equals(addedRole)) count++;
                roleGap += Math.max(0, floor.getValue() - count);
            }
            int total = present + (addedRole == null ? 0 : 1);
            return (long) (band.end() - band.start()) * Math.max(Math.max(0, band.minimum() - total), roleGap);
        }
        void add(String role) {
            present++;
            if (band.roleMinima().containsKey(role)) roles.merge(role, 1, Integer::sum);
        }
    }

    static Outcome seed(Roster roster, long deadline) {
        if (roster.days().stream().allMatch(day -> day.state() != null)) return Outcome.COMPLETE;
        if (System.nanoTime() >= deadline) return Outcome.TIME_LIMIT;
        var people = new LinkedHashMap<String, List<Day>>();
        for (Day day : roster.days()) people.computeIfAbsent(day.person(), k -> new ArrayList<>()).add(day);
        if (people.isEmpty() || people.size() > 50) return Outcome.UNSUPPORTED;
        var windows = new HashMap<String, List<Roster.Window>>();
        for (var window : roster.windows()) windows.computeIfAbsent(window.person(), k -> new ArrayList<>()).add(window);
        var bands = new HashMap<String, List<BandState>>();
        for (var band : roster.bands()) bands.computeIfAbsent(band.sector(), k -> new ArrayList<>()).add(new BandState(band));
        var attendance = new HashMap<String, int[]>();
        var cached = new HashMap<Shape, List<Integer>>();
        var selected = new LinkedHashMap<String, Integer>();
        for (var entry : people.entrySet()) {
            if (System.nanoTime() >= deadline) return Outcome.TIME_LIMIT;
            var days = entry.getValue();
            days.sort(Comparator.comparingInt(Day::index));
            Shape shape = shape(days, windows.getOrDefault(entry.getKey(), List.of()));
            if (shape == null) return Outcome.UNSUPPORTED;
            var masks = cached.get(shape);
            if (masks == null) {
                masks = new ArrayList<>();
                if (!enumerate(shape, 0, 0, masks, deadline)) return Outcome.TIME_LIMIT;
                if (masks.isEmpty()) return Outcome.NO_PATTERN;
                cached.put(shape, masks);
            }
            Day representative = days.getFirst();
            if (days.stream().anyMatch(day -> !day.sector().equals(representative.sector())
                    || !day.role().equals(representative.role()) || !day.shift().equals(representative.shift()))) return Outcome.UNSUPPORTED;
            var sectorBands = bands.getOrDefault(representative.sector(), List.of());
            int[] staffed = attendance.computeIfAbsent(representative.sector(), k -> new int[shape.days()]);
            if (staffed.length != shape.days()) return Outcome.UNSUPPORTED;
            long[] hard = new long[shape.days()], total = new long[shape.days()];
            for (BandState band : sectorBands) {
                int day = band.band.day();
                if (day < 0 || day >= shape.days()) return Outcome.UNSUPPORTED;
                if (!days.get(day).covers(band.band.start(), band.band.end())) continue;
                long gain = band.gap(null) - band.gap(representative.role());
                if (band.band.estimated()) total[day] += gain;
                else hard[day] += gain;
            }
            Rank bestRank = null;
            int best = 0, trials = 0;
            for (int mask : masks) {
                if ((trials++ & 255) == 0 && System.nanoTime() >= deadline) return Outcome.TIME_LIMIT;
                long h = 0, t = 0, s = 0, service = 0, balance = 0, stability = 0;
                for (int bits = mask; bits != 0; bits &= bits - 1) {
                    int day = Integer.numberOfTrailingZeros(bits);
                    h += hard[day]; t += total[day];
                    if (day % 7 == 0) s += total[day];
                    if (staffed[day] == 0) service++;
                    balance -= staffed[day];
                    Day.State prior = days.get(day).state();
                    if (prior != null) stability += prior == Day.State.WORK ? 1 : -1;
                }
                Rank rank = new Rank(h, t, s, service, balance, stability);
                if (bestRank == null || rank.compareTo(bestRank) > 0) { best = mask; bestRank = rank; }
            }
            if (bestRank == null) return Outcome.NO_PATTERN;
            selected.put(entry.getKey(), best);
            for (int bits = best; bits != 0; bits &= bits - 1) staffed[Integer.numberOfTrailingZeros(bits)]++;
            for (BandState band : sectorBands) if ((best & (1 << band.band.day())) != 0
                    && days.get(band.band.day()).covers(band.band.start(), band.band.end())) band.add(representative.role());
        }
        // Commit only after the whole bounded construction succeeded.
        if (System.nanoTime() >= deadline) return Outcome.TIME_LIMIT;
        for (var entry : people.entrySet()) {
            int mask = selected.get(entry.getKey());
            for (Day day : entry.getValue()) {
                if (!day.isPinned()) day.setState((mask & (1 << day.index())) != 0 ? Day.State.WORK : Day.State.OFF);
            }
        }
        return Outcome.APPLIED;
    }
}
