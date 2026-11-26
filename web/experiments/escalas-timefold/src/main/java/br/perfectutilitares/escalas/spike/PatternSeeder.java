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
                         List<Rule> rules, List<PatternRule> patterns, boolean consecutive) {
        boolean allows(int mask) {
            if ((mask & pinnedWork) != pinnedWork || (mask & pinnedOff) != 0) return false;
            for (Rule rule : rules) if (!rule.allows(mask)) return false;
            if(consecutive){
                int off=~mask&((1<<days)-1);
                if((off&~((off<<1)|(off>>>1)))!=0)return false;
            }
            int common = 0;
            for (PatternRule pattern : patterns)
                if (Integer.bitCount(~mask & pattern.bits()) == pattern.weeks() && ++common > 1) return false;
            return true;
        }
    }
    private record Rank(long hard, long total, long sunday, long service, long rest, long balance, long stability,long preference)
            implements Comparable<Rank> {
        @Override public int compareTo(Rank other) {
            int c = Long.compare(hard, other.hard);
            if (c != 0) return c;
            // An experimentally prioritized Sunday construction. Hard confirmed
            // coverage still wins; no estimate is converted into a hard rule.
            c = Long.compare(sunday, other.sunday);
            if (c != 0) return c;
            c = Long.compare(service, other.service);
            if (c != 0) return c;
            c = Long.compare(total, other.total);
            if (c != 0) return c;
            c = Long.compare(rest, other.rest);
            if (c != 0) return c;
            c = Long.compare(balance, other.balance);
            if(c!=0)return c;
            c=Long.compare(stability,other.stability);
            return c!=0?c:Long.compare(preference,other.preference);
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
        return new Shape(length, pinnedWork, pinnedOff, List.copyOf(rules), List.copyOf(patterns),days.getFirst().isConsecutiveRequired());
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
        void change(String role, int delta) {
            present += delta;
            if (present < 0) throw new IllegalStateException("NEGATIVE_PRESENCE");
            if (band.roleMinima().containsKey(role)) {
                int next = roles.getOrDefault(role, 0) + delta;
                if (next < 0) throw new IllegalStateException("NEGATIVE_ROLE_PRESENCE");
                if (next == 0) roles.remove(role);
                else roles.put(role, next);
            }
        }
    }

    private record Choice(int mask, Rank rank) {}
    private record Cohort(List<Day> days, List<Integer> masks, List<BandState> bands, int[] staffed) {}

    private static Rank rank(int mask, List<Day> days, int[] staffed, long[] hard, long[] total) {
        long h = 0, t = 0, s = 0, service = 0, balance = 0, stability = 0, preference=0;
        for (int bits = mask; bits != 0; bits &= bits - 1) {
            int day = Integer.numberOfTrailingZeros(bits);
            h += hard[day]; t += total[day];
            if (day % 7 == 0) s += total[day];
            if (staffed[day] == 0) service++;
            balance -= staffed[day];
            if(days.get(day).isPreferredOff())preference--;
            Day.State prior = days.get(day).state();
            if (prior != null) stability += prior == Day.State.WORK ? 1 : -1;
        }
        if(days.getFirst().isPreferConsecutive()){
            int off=~mask&((1<<days.size())-1);
            preference+=Integer.bitCount(off&(off>>>1));
        }
        return new Rank(h, t, s, service, -adjustablePairs(mask, days), balance, stability,preference);
    }

    static int adjustablePairs(int workMask, List<Day> days) {
        if(!days.getFirst().isAdjustableRest())return 0;
        int offMask = ~workMask & ((1 << days.size()) - 1);
        int count = 0;
        for (int bits = offMask & (offMask >>> 1); bits != 0; bits &= bits - 1) {
            int i = Integer.numberOfTrailingZeros(bits);
            if (!(days.get(i).isPinned() && days.get(i + 1).isPinned())) count++;
        }
        return count;
    }

    private static Choice choose(Cohort cohort, Integer incumbent, long deadline) {
        var days = cohort.days();
        String role = days.getFirst().role();
        long[] hard = new long[days.size()], total = new long[days.size()];
        for (BandState state : cohort.bands()) {
            int day = state.band.day();
            if (!days.get(day).covers(state.band.start(), state.band.end())) continue;
            long gain = state.gap(null) - state.gap(role);
            if (state.band.estimated()) total[day] += gain;
            else hard[day] += gain;
        }
        Rank prior = incumbent == null ? null : rank(incumbent, days, cohort.staffed(), hard, total);
        Choice best = prior == null ? null : new Choice(incumbent, prior);
        int protectedDays = 0;
        if (incumbent != null) for (int bits = incumbent; bits != 0; bits &= bits - 1) {
            int day = Integer.numberOfTrailingZeros(bits);
            if (cohort.staffed()[day] == 0) protectedDays |= 1 << day;
        }
        int trials = 0;
        for (int mask : cohort.masks()) {
            if ((trials++ & 127) == 0 && System.nanoTime() >= deadline) return null;
            Rank candidate = rank(mask, days, cohort.staffed(), hard, total);
            // Whole-person compound move: other people are unchanged and this
            // person stays within the same sector. Never purchase an improvement
            // with a new confirmed, total, Sunday or daily-presence deficit.
            if (prior != null && ((mask & protectedDays) != protectedDays || candidate.hard() < prior.hard()
                    || candidate.sunday() < prior.sunday()
                    || (candidate.service() <= prior.service() && candidate.total() < prior.total()))) continue;
            if (best == null || candidate.compareTo(best.rank()) > 0) best = new Choice(mask, candidate);
        }
        return best;
    }

    private static void apply(Cohort cohort, int mask, int delta) {
        for (int bits = mask; bits != 0; bits &= bits - 1)
            cohort.staffed()[Integer.numberOfTrailingZeros(bits)] += delta;
        for (BandState state : cohort.bands()) {
            int day = state.band.day();
            if ((mask & (1 << day)) != 0 && cohort.days().get(day).covers(state.band.start(), state.band.end()))
                state.change(cohort.days().getFirst().role(), delta);
        }
    }

    private record PairCost(long hard, long sunday, long total, int peak, int rest) implements Comparable<PairCost> {
        @Override public int compareTo(PairCost other) {
            int c = Long.compare(hard, other.hard);
            if (c == 0) c = Long.compare(sunday, other.sunday);
            if (c == 0) c = Long.compare(total, other.total);
            if (c == 0) c = Integer.compare(peak, other.peak);
            return c != 0 ? c : Integer.compare(rest, other.rest);
        }
    }

    private record DayCost(long hard, long sunday, long total, int peak) {}

    /** Costs for the four possible attendance combinations of a two-person
     * sector. Compute once from clock and role floors, not once per mask pair.
     */
    private static DayCost[][] pairCosts(Cohort a, Cohort b) {
        int days = a.days().size();
        DayCost[][] costs = new DayCost[days][4];
        for (int day = 0; day < days; day++) {
            for (int state = 0; state < 4; state++) {
                long hard = 0, sunday = 0, total = 0;
                int peak = 0;
                for (BandState item : a.bands()) {
                    var band = item.band;
                    if (band.day() != day) continue;
                    Day first = a.days().get(day), second = b.days().get(day);
                    boolean worksA = (state & 1) != 0 && first.covers(band.start(), band.end());
                    boolean worksB = (state & 2) != 0 && second.covers(band.start(), band.end());
                    Map<String, Set<String>> members = new HashMap<>();
                    if (worksA) members.computeIfAbsent(first.role(), k -> new HashSet<>()).add(first.id());
                    if (worksB) members.computeIfAbsent(second.role(), k -> new HashSet<>()).add(second.id());
                    long gap = band.missing((worksA ? 1 : 0) + (worksB ? 1 : 0), members);
                    if (band.estimated()) {
                        total += gap;
                        if (day % 7 == 0) sunday += gap;
                        peak = Math.max(peak, Math.toIntExact(gap / (band.end() - band.start())));
                    } else hard += gap;
                }
                costs[day][state] = new DayCost(hard, sunday, total, peak);
            }
        }
        return costs;
    }

    private static PairCost pairCost(Cohort a, Cohort b, int first, int second, DayCost[][] costs) {
        long hard = 0, sunday = 0, total = 0;
        int peak = 0;
        for (int i = 0; i < costs.length; i++) {
            DayCost day = costs[i][((first >>> i) & 1) | (((second >>> i) & 1) << 1)];
            hard += day.hard(); sunday += day.sunday(); total += day.total();
            peak = Math.max(peak, day.peak());
        }
        return new PairCost(hard, sunday, total, peak,
                adjustablePairs(first, a.days()) + adjustablePairs(second, b.days()));
    }

    /** Joint replacement escapes the local minimum where either individual
     * move would remove the other employee's only coverage. No hard rule is
     * relaxed: every enumerated mask is already individually admissible.
     * Accept full daily service only if confirmed and Sunday gaps do not grow.
     */
    private static void recoverTwoPersonService(Map<String, Cohort> cohorts, Map<String, Integer> selected,
                                                long deadline) {
        var sectors = new LinkedHashMap<String, List<String>>();
        for (var entry : cohorts.entrySet()) sectors.computeIfAbsent(entry.getValue().days().getFirst().sector(),
                k -> new ArrayList<>()).add(entry.getKey());
        for (var sector : sectors.values()) {
            if (System.nanoTime() >= deadline) return;
            if (sector.size() != 2) continue;
            String personA = sector.get(0), personB = sector.get(1);
            Cohort a = cohorts.get(personA), b = cohorts.get(personB);
            int oldA = selected.get(personA), oldB = selected.get(personB);
            int full = (1 << a.days().size()) - 1;
            if ((oldA | oldB) == full) continue;
            DayCost[][] costs = pairCosts(a, b);
            PairCost before = pairCost(a, b, oldA, oldB, costs), best = null;
            int bestA = oldA, bestB = oldB;
            // Start with the incumbent A, then deterministic enumeration. A
            // bitwise union rejects shared OFF dates before scoring a pair.
            var firstMasks = new ArrayList<Integer>(a.masks().size() + 1);
            firstMasks.add(oldA);
            for (int mask : a.masks()) if (mask != oldA) firstMasks.add(mask);
            long checked = 0;
            int scored = 0;
            search:
            for (int first : firstMasks) {
                for (int second : b.masks()) {
                    if ((checked++ & 511) == 0 && System.nanoTime() >= deadline) break search;
                    if ((first | second) != full) continue;
                    PairCost candidate = pairCost(a, b, first, second, costs);
                    if (candidate.hard() <= before.hard() && candidate.sunday() <= before.sunday()
                            && (best == null || candidate.compareTo(best) < 0)) {
                        best = candidate; bestA = first; bestB = second;
                    }
                    // Keep bounded work even on fast or unusual hardware.
                    if (++scored >= 20_000) break search;
                }
            }
            if (best == null) continue;
            apply(a, oldA, -1); apply(b, oldB, -1);
            apply(a, bestA, 1); apply(b, bestB, 1);
            selected.put(personA, bestA); selected.put(personB, bestB);
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
        var cohorts = new LinkedHashMap<String, Cohort>();
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
            for (BandState band : sectorBands)
                if (band.band.day() < 0 || band.band.day() >= shape.days()) return Outcome.UNSUPPORTED;
            Cohort cohort = new Cohort(days, masks, sectorBands, staffed);
            Choice choice = choose(cohort, null, deadline);
            if (choice == null) return System.nanoTime() >= deadline ? Outcome.TIME_LIMIT : Outcome.NO_PATTERN;
            cohorts.put(entry.getKey(), cohort);
            selected.put(entry.getKey(), choice.mask());
            apply(cohort, choice.mask(), 1);
        }
        // Once the complete greedy grid exists, explore up to two bounded
        // sweeps of whole-person pattern replacements. A partial sweep keeps
        // the last complete selection; the caller never sees intermediate cells.
        if (System.nanoTime() >= deadline) return Outcome.TIME_LIMIT;
        recoverTwoPersonService(cohorts, selected, deadline);
        for (int pass = 0; pass < 2; pass++) {
            boolean changed = false;
            for (var entry : cohorts.entrySet()) {
                if (System.nanoTime() >= deadline) break;
                Cohort cohort = entry.getValue();
                int prior = selected.get(entry.getKey());
                apply(cohort, prior, -1);
                Choice choice = choose(cohort, prior, deadline);
                int next = choice == null ? prior : choice.mask();
                selected.put(entry.getKey(), next);
                apply(cohort, next, 1);
                changed |= prior != next;
                if (choice == null) break;
            }
            if (!changed || System.nanoTime() >= deadline) break;
        }
        // A complete selection existed before the bounded polishing phase.
        // Commit it even if that optional phase reached its own deadline.
        for (var entry : people.entrySet()) {
            int mask = selected.get(entry.getKey());
            for (Day day : entry.getValue()) {
                if (!day.isPinned()) day.setState((mask & (1 << day.index())) != 0 ? Day.State.WORK : Day.State.OFF);
            }
        }
        return Outcome.APPLIED;
    }
}
