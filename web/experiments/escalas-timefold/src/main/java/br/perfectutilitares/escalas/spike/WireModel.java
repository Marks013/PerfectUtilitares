package br.perfectutilitares.escalas.spike;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Strictly bounded subset of the private wire. Unsupported scenarios fail closed.
 * E2 deliberately does not implement December, holidays, absences, histories, UNTIMED,
 * variable clocks, protected coverage or the full lexicographic objective.
 */
final class WireModel {
    static final class Unsupported extends IllegalArgumentException {
        Unsupported(String code) { super(code); }
    }
    record Person(String id, String sector, String role, String shift, List<Day.Segment> work, int sundayCap) {}
    record Key(String person, String date) {}
    record Record(Day.State state, String shift, Boolean locked) {}
    record DemandKey(int day, String sector, boolean estimated) {}
    record Demand(int start, int end, int minimum, String role) {}

    private static void check(boolean ok, String code) {
        if (!ok) throw new Unsupported(code);
    }
    private static String str(JsonNode n, String key) {
        JsonNode v = n.path(key);
        check(v.isTextual(), "EXPECTED_TEXT");
        return v.textValue();
    }
    private static int integer(JsonNode n, String key) {
        JsonNode v = n.path(key);
        check(v.isIntegralNumber() && v.canConvertToInt(), "EXPECTED_INTEGER");
        return v.intValue();
    }
    private static List<JsonNode> array(JsonNode n, String key) {
        JsonNode v = n.path(key);
        check(v.isArray(), "EXPECTED_ARRAY");
        check(v.size() <= 12000, "ARRAY_LIMIT");
        List<JsonNode> out = new ArrayList<>();
        v.forEach(out::add);
        return out;
    }
    private static boolean bool(JsonNode n, String key, boolean fallback) {
        if (!n.has(key)) return fallback;
        check(n.path(key).isBoolean(), "EXPECTED_BOOLEAN");
        return n.path(key).booleanValue();
    }
    private static String optionalEnum(JsonNode n, String key, String fallback, String... options) {
        if (!n.has(key)) return fallback;
        String value = str(n, key);
        check(Arrays.asList(options).contains(value), "UNSUPPORTED_ENUM");
        return value;
    }
    private static boolean startsBy(JsonNode person, LocalDate first) {
        String value = str(person, "activeFrom");
        if (value.isEmpty()) return true;
        check(value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"), "ACTIVE_DATE");
        return !LocalDate.parse(value).isAfter(first);
    }
    private static boolean empty(JsonNode n, String key) {
        return !n.has(key) || n.path(key).isArray() && n.path(key).isEmpty()
                || n.path(key).isObject() && n.path(key).isEmpty();
    }

    static Roster read(JsonNode root) {
        check(root != null && root.isObject() && root.size() == 1 && root.path("input").isObject(), "ENVELOPE");
        JsonNode input = root.path("input"), policy = input.path("policy");
        check(integer(input, "schemaVersion") == 1 && str(input, "branchCode").equals("SYNTH")
                && bool(input, "simulation", false), "SYNTHETIC_ONLY");
        check(str(input, "timeZone").equals("America/Sao_Paulo")
                && str(input, "planningWeekStartsOn").equals("SUNDAY")
                && integer(input, "restRulesVersion") == 3
                && optionalEnum(input, "generationMode", "DAYS_AND_HOURS", "DAYS_AND_HOURS").equals("DAYS_AND_HOURS")
                && integer(input, "defaultWeeklyHours") == 42, "MODE");
        // Exact November fixtures: no calendar clipping, DST, or transition assumptions.
        LocalDate first = LocalDate.parse(str(input, "startDate"));
        LocalDate last = LocalDate.parse(str(input, "endDate"));
        int days = Math.toIntExact(ChronoUnit.DAYS.between(first, last) + 1);
        check(first.equals(LocalDate.of(2026, 11, 1)) && (days == 7 || days == 28)
                && !input.has("visibleMonth"), "HORIZON");
        for (String field : List.of("_coverageComparison", "_coverageServiceProtection", "_coverageProtection", "_restPairTarget"))
            check(!input.has(field), "PROTECTED_COVERAGE_UNSUPPORTED");
        input.fieldNames().forEachRemaining(field ->
                check(!field.startsWith("_") || field.equals("_initialAssignments"), "UNKNOWN_PRIVATE_FIELD"));
        for (String field : List.of("mixed42Sectors", "movementPriorities"))
            check(empty(input, field), "UNSUPPORTED_INPUT");
        check(policy.path("calendarMode").asText().equals("MANUAL")
                && optionalEnum(policy, "normativeProfile", "CUSTOM", "CUSTOM").equals("CUSTOM")
                && integer(policy, "weeklyLimit") >= 42 && integer(policy, "dailyLimitMinutes") >= 504
                && integer(policy, "maxConsecutiveWorkDays") == 5, "POLICY");
        for (String field : List.of("closedDates", "holidayDates", "authorizedHolidayDates", "paidHolidayDates"))
            check(empty(policy, field), "HOLIDAY_UNSUPPORTED");
        check(!policy.has("mealIntervalAgreement"), "MEAL_AGREEMENT_UNSUPPORTED");
        int closing = integer(input, "storeClosingMinutes");
        check(closing >= 1 && closing <= 1440
                && integer(policy, "minMealMinutes") >= 30 && integer(policy, "minMealMinutes") <= 180
                && integer(policy, "minInterShiftMinutes") >= 660 && integer(policy, "minInterShiftMinutes") <= 1440
                && integer(policy, "minWeeklyRestMinutes") >= 2100 && integer(policy, "minWeeklyRestMinutes") <= 4320,
                "POLICY_LIMITS");
        Map<String, List<Day.Segment>> clocks = new HashMap<>();
        for (JsonNode clock : array(input, "shifts")) {
            String id = str(clock, "id");
            List<JsonNode> segments = array(clock, "segments");
            check(segments.size() == 3 && str(segments.get(0), "kind").equals("WORK")
                    && str(segments.get(1), "kind").equals("BREAK") && str(segments.get(2), "kind").equals("WORK"), "CLOCK_KIND");
            int a = integer(segments.get(0), "start"), b = integer(segments.get(0), "end");
            int c = integer(segments.get(1), "start"), d = integer(segments.get(1), "end");
            int e = integer(segments.get(2), "start"), f = integer(segments.get(2), "end");
            check(a >= 300 && a < b && b == c && c < d && d == e && e < f && f <= Math.min(1200, closing)
                    && b - a + f - e == 504 && d - c >= integer(policy, "minMealMinutes") && d - c <= 120
                    && 1440 - (f - a) >= integer(policy, "minInterShiftMinutes")
                    && 2880 - (f - a) >= integer(policy, "minWeeklyRestMinutes"), "CLOCK_GEOMETRY");
            check(!bool(policy, "limitContinuousWorkBlocks", false) || Math.max(b - a, f - e) <= 270,
                    "CLOCK_BLOCKS");
            check(clocks.put(id, List.of(new Day.Segment(a, b), new Day.Segment(e, f))) == null, "DUPLICATE_CLOCK");
        }

        Map<String, Person> people = new LinkedHashMap<>();
        for (JsonNode person : array(input, "employees")) {
            String id = str(person, "id"), name = str(person, "name");
            check(id.matches("person-[0-9]+") && name.startsWith("Synthetic person "), "SYNTHETIC_ID");
            check(bool(person, "planningEnabled", true)
                    && str(person, "scheduleMode").equals("TIMED") && integer(person, "weeklyHours") == 42
                    && str(person, "offMode").equals("VARIABLE") && str(person, "offPattern").equals("ANY")
                    && !bool(person, "historyKnown", false) && !person.has("simulationDailyMinutes")
                    && !person.has("activeUntil") && startsBy(person, first), "PERSON_PROFILE");
            optionalEnum(person, "weeklyHoursMode", "INDIVIDUAL", "INDIVIDUAL", "BRANCH");
            for (String field : List.of("history", "planningHistory", "planningFuture", "fixedOffDays",
                    "preferredOffDays", "manualShiftByDate", "manualShiftOverrides", "manualShiftBaseIds"))
                check(empty(person, field), "PERSON_RESTRICTION_UNSUPPORTED");
            check(!person.has("fixedRestSlots") || person.path("fixedRestSlots").isArray()
                    && person.path("fixedRestSlots").size() == 2
                    && java.util.stream.StreamSupport.stream(person.path("fixedRestSlots").spliterator(), false)
                        .allMatch(slot -> slot.path("enabled").isBoolean() && !slot.path("enabled").booleanValue()),
                    "FIXED_REST_UNSUPPORTED");
            List<JsonNode> options = array(person, "shiftIds");
            String fixed = person.path("fixedImportedShiftId").asText("");
            check(options.size() == 1 && options.getFirst().isTextual()
                    && (fixed.isEmpty() || fixed.equals(options.getFirst().textValue())), "CLOCK_OPTIONS");
            String shift = options.getFirst().textValue();
            check(clocks.containsKey(shift), "CLOCK_REFERENCE");
            int cap = integer(person, "maxConsecutiveSundays");
            check(cap == 1 || cap == 2, "SUNDAY_CAP");
            String sundayRule = optionalEnum(person, "sundayRestRule", "PROTECTIVE",
                    "PROTECTIVE", "UNREVIEWED", "CLT_386", "COMMERCE");
            if (!sundayRule.equals("COMMERCE")) cap = 1;
            check(people.put(id, new Person(id, str(person, "sector"), str(person, "role"),
                    shift, clocks.get(shift), cap)) == null, "DUPLICATE_PERSON");
        }
        check(!people.isEmpty() && people.size() <= 50, "PEOPLE_LIMIT");
        Map<Key, Record> saved = records(input, "assignments", people, first, last);
        Map<Key, Record> seed = input.has("_initialAssignments") ? records(input, "_initialAssignments", people, first, last) : saved;
        // Saved grids may contain only a few locks. Explicit private warm-starts
        // must contain every expected person/date once (records checks duplicates).
        if (input.has("_initialAssignments")) {
            check(seed.size() == Math.multiplyExact(people.size(), days), "INCOMPLETE_SEED");
        }
        List<Day> cells = new ArrayList<>();
        List<Roster.Window> windows = new ArrayList<>();
        int weeks = days / 7;
        for (Person person : people.values()) {
            Set<Integer> comparable = new HashSet<>();
            for (int week = 0; week < weeks; week++) {
                boolean hasLock = false;
                for (int j = 0; j < 7; j++) {
                    Record old = saved.get(new Key(person.id(), first.plusDays(week * 7 + j).toString()));
                    hasLock |= old != null && Boolean.TRUE.equals(old.locked());
                }
                if (!hasLock) comparable.add(week);
                windows.add(new Roster.Window(person.id(), week * 7, week * 7 + 6, 1, Day.State.WORK, 5, 5));
            }
            for (int i = 0; i + 5 < days; i++)
                windows.add(new Roster.Window(person.id(), i, i + 5, 1, Day.State.WORK, 0, 5));
            for (int i = 0; i + 2 < days; i++) {
                // Fully imposed OFF runs are exempt, as in the original.
                boolean mutable = false;
                for (int j = i; j <= i + 2; j++) {
                    Record old = saved.get(new Key(person.id(), first.plusDays(j).toString()));
                    mutable |= old == null || !Boolean.TRUE.equals(old.locked());
                }
                if (mutable) windows.add(new Roster.Window(person.id(), i, i + 2, 1, Day.State.OFF, 0, 2));
            }
            for (int week = 0; week + person.sundayCap() < weeks; week++)
                windows.add(new Roster.Window(person.id(), week * 7, (week + person.sundayCap()) * 7,
                        7, Day.State.WORK, 0, person.sundayCap()));
            for (int i = 0; i < days; i++) {
                String date = first.plusDays(i).toString();
                Record old = saved.get(new Key(person.id(), date)), initial = seed.get(new Key(person.id(), date));
                boolean locked = old != null && Boolean.TRUE.equals(old.locked());
                boolean saturday = i % 7 == 6;
                check(!saturday || !locked || old.state() == Day.State.WORK, "LOCKED_SATURDAY");
                check(!locked || initial == null || initial.state() == old.state(), "SEED_LOCK_CONFLICT");
                Day.State state = locked ? old.state() : saturday ? Day.State.WORK : initial == null ? null : initial.state();
                var pattern = comparable.size() >= 2 && comparable.contains(i / 7)
                        ? new Day.PatternKey(person.id(), i % 7, comparable.size()) : null;
                var cell = new Day(person.id(), person.sector(), person.role(), person.shift(), i, date,
                        person.work(), saturday || locked, old == null ? null : old.locked(),
                        old == null ? null : old.state(), state, pattern);
                cell.setSundayCap(person.sundayCap());
                cells.add(cell);
            }
        }
        // Disjoint bands per day/sector/demand type; preserve all function floors.
        Map<DemandKey, List<Demand>> grouped = new LinkedHashMap<>();
        for (JsonNode demand : array(input, "demands")) {
            int day = Math.toIntExact(ChronoUnit.DAYS.between(first, LocalDate.parse(str(demand, "date"))));
            int a = integer(demand, "start"), b = integer(demand, "end"), min = integer(demand, "minimum");
            check(day >= 0 && day < days && a >= 0 && b <= 1440 && a < b && min >= 0 && min <= 250, "DEMAND");
            String role = demand.hasNonNull("role") ? str(demand, "role") : null;
            DemandKey key = new DemandKey(day, str(demand, "sector"), bool(demand, "estimated", false));
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(new Demand(a, b, min, role));
        }
        List<Roster.Band> bands = new ArrayList<>();
        for (var entry : grouped.entrySet()) {
            DemandKey key = entry.getKey();
            List<Demand> demands = entry.getValue();
            var edges = new TreeSet<Integer>();
            for (Demand demand : demands) { edges.add(demand.start()); edges.add(demand.end()); }
            for (Person person : people.values()) {
                if (!person.sector().equals(key.sector())) continue;
                for (var work : person.work()) { edges.add(work.start()); edges.add(work.end()); }
            }
            List<Integer> boundaries = new ArrayList<>(edges);
            for (int i = 1; i < boundaries.size(); i++) {
                int a = boundaries.get(i - 1), b = boundaries.get(i);
                int general = 0;
                Map<String, Integer> floors = new TreeMap<>();
                for (Demand demand : demands) {
                    if (demand.start() > a || demand.end() < b || demand.minimum() == 0) continue;
                    if (demand.role() == null || demand.role().isEmpty()) general = Math.max(general, demand.minimum());
                    else floors.merge(demand.role(), demand.minimum(), Math::max);
                }
                if (general > 0 || !floors.isEmpty()) {
                    bands.add(new Roster.Band(key.day(), key.sector(), a, b, general, floors, key.estimated()));
                    check(bands.size() <= 12000, "BAND_LIMIT");
                }
            }
        }
        check(bands.size() <= 12000, "BAND_LIMIT");
        return new Roster(cells, windows, bands);
    }

    private static Map<Key, Record> records(JsonNode input, String field, Map<String, Person> people,
            LocalDate first, LocalDate last) {
        Map<Key, Record> result = new HashMap<>();
        for (JsonNode row : array(input, field)) {
            String person = str(row, "employeeId"), date = str(row, "date");
            LocalDate day = LocalDate.parse(date);
            check(people.containsKey(person) && !day.isBefore(first) && !day.isAfter(last), "ASSIGNMENT_REFERENCE");
            String kind = str(row, "kind");
            check(kind.equals("WORK") || kind.equals("OFF"), "ASSIGNMENT_KIND_UNSUPPORTED");
            String shift = row.hasNonNull("shiftId") ? str(row, "shiftId") : null;
            check(kind.equals("WORK") ? people.get(person).shift().equals(shift) : shift == null, "ASSIGNMENT_CLOCK");
            check(!row.has("locked") || row.path("locked").isBoolean(), "LOCK_TYPE");
            var key = new Key(person, date);
            var record = new Record(Day.State.valueOf(kind), shift, row.has("locked") ? row.path("locked").booleanValue() : null);
            check(result.put(key, record) == null, "DUPLICATE_ASSIGNMENT");
        }
        return result;
    }
}
