package br.perfectutilitares.escalas.spike;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class WireModelTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private ObjectNode envelope() throws Exception {
        return (ObjectNode) JSON.readTree("""
            {"input":{"schemaVersion":1,"branchCode":"SYNTH","simulation":true,
            "timeZone":"America/Sao_Paulo","planningWeekStartsOn":"SUNDAY","restRulesVersion":3,
            "generationMode":"DAYS_AND_HOURS","defaultWeeklyHours":42,"startDate":"2026-11-01","endDate":"2026-11-07",
            "storeClosingMinutes":1200,"policy":{"calendarMode":"MANUAL","normativeProfile":"CUSTOM",
            "weeklyLimit":44,"dailyLimitMinutes":528,"maxConsecutiveWorkDays":5,"minMealMinutes":60,
            "minInterShiftMinutes":660,"minWeeklyRestMinutes":2100,"closedDates":[],"holidayDates":[],"authorizedHolidayDates":[]},
            "shifts":[{"id":"clock","segments":[{"kind":"WORK","start":420,"end":660},{"kind":"BREAK","start":660,"end":780},{"kind":"WORK","start":780,"end":1044}]}],
            "employees":[{"id":"person-0","name":"Synthetic person 0","sector":"S","role":"Caixa","weeklyHours":42,
            "shiftIds":["clock"],"scheduleMode":"TIMED","offMode":"VARIABLE","offPattern":"ANY","activeFrom":"",
            "maxConsecutiveSundays":1,"historyKnown":false,"history":[],"fixedOffDays":[],"preferredOffDays":[]}],
            "assignments":[],"demands":[]}}
            """);
    }
    @Test void combinesDuplicateAndOverlappingRoleFloors() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.set("demands", JSON.readTree("""
          [{"id":"d-1","date":"2026-11-01","sector":"S","start":480,"end":540,"minimum":2,"estimated":true},
           {"id":"d-2","date":"2026-11-01","sector":"S","role":"Caixa","start":480,"end":540,"minimum":1,"estimated":true},
           {"id":"d-3","date":"2026-11-01","sector":"S","role":"Caixa","start":510,"end":540,"minimum":1,"estimated":true},
           {"id":"d-4","date":"2026-11-01","sector":"S","role":"Repositor","start":480,"end":540,"minimum":1,"estimated":true}]
          """));
        var model = WireModel.read(root);
        assertEquals(7, model.days().size());
        assertEquals(2, model.bands().size());
        long gap = model.bands().stream().mapToLong(b -> b.missing(1, Map.of("Caixa", java.util.Set.of("person-0")))).sum();
        assertEquals(60, gap);
    }
    @Test void partialSavedLocksDoNotRequireACompleteSeed() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.set("assignments", JSON.readTree("[{\"employeeId\":\"person-0\",\"date\":\"2026-11-01\",\"kind\":\"OFF\",\"locked\":true}]"));
        var model = WireModel.read(root);
        assertTrue(model.days().getFirst().isPinned());
        assertEquals(Day.State.OFF, model.days().getFirst().state());
        assertNull(model.days().get(1).state());
        assertTrue(model.days().getLast().isPinned());
        assertEquals(Day.State.WORK, model.days().getLast().state());
        input.set("_initialAssignments", input.get("assignments"));
        assertEquals("INCOMPLETE_SEED", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsEmptyAndConflictingExplicitWarmStarts() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.set("assignments", JSON.readTree("""
            [{"employeeId":"person-0","date":"2026-11-01","kind":"OFF","locked":true}]
            """));
        var seed = input.putArray("_initialAssignments");
        assertEquals("INCOMPLETE_SEED", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        for (int i = 1; i <= 7; i++) {
            var row = seed.addObject();
            row.put("employeeId", "person-0");
            row.put("date", "2026-11-0" + i);
            if (i == 1 || i == 4) row.put("kind", "OFF");
            else { row.put("kind", "WORK"); row.put("shiftId", "clock"); }
        }
        var model = WireModel.read(root);
        assertEquals(7, model.days().stream().filter(day -> day.state() != null).count());
        assertTrue(model.days().getFirst().isPinned());
        assertEquals(Day.State.OFF, model.days().getFirst().state());
        var conflict = (ObjectNode) seed.get(0);
        conflict.put("kind", "WORK");
        conflict.put("shiftId", "clock");
        assertEquals("SEED_LOCK_CONFLICT", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsDuplicateExplicitWarmStartCells() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.set("_initialAssignments", JSON.readTree("""
            [{"employeeId":"person-0","date":"2026-11-01","kind":"OFF"},
             {"employeeId":"person-0","date":"2026-11-01","kind":"OFF"}]
            """));
        assertEquals("DUPLICATE_ASSIGNMENT", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsPrivateProtectionAndOtherGenerationModes() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.put("_restPairTarget", 20);
        assertThrows(WireModel.Unsupported.class, () -> WireModel.read(root));
        input.remove("_restPairTarget");
        input.put("generationMode", "HOURS_ONLY");
        assertThrows(WireModel.Unsupported.class, () -> WireModel.read(root));
    }
    @Test void rejectsCoercedBooleanAndUnknownPrivateField() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.put("simulation", "true");
        assertEquals("EXPECTED_BOOLEAN", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        input.put("simulation", true);
        input.put("_unknownConstraint", true);
        assertEquals("UNKNOWN_PRIVATE_FIELD", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsUnknownSundayRuleAndMalformedEmploymentDate() throws Exception {
        var root = envelope();
        var person = (ObjectNode) root.path("input").path("employees").get(0);
        person.put("sundayRestRule", "UNKNOWN");
        assertEquals("UNSUPPORTED_ENUM", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        person.put("sundayRestRule", "COMMERCE");
        person.put("maxConsecutiveSundays", 2);
        assertEquals(2, WireModel.read(root).days().getFirst().getSundayCap());
        person.put("activeFrom", "0000");
        assertEquals("ACTIVE_DATE", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsInvalidPolicyLimitsAndDemandBoolean() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        var policy = (ObjectNode) input.path("policy");
        policy.put("minWeeklyRestMinutes", 0);
        assertEquals("POLICY_LIMITS", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        policy.put("minWeeklyRestMinutes", 2100);
        input.set("demands", JSON.readTree("""
            [{"id":"d-1","date":"2026-11-01","sector":"S","start":480,"end":540,"minimum":1,"estimated":"true"}]
            """));
        assertEquals("EXPECTED_BOOLEAN", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void rejectsUnmodelledMetadataAndClockBounds() throws Exception {
        var root = envelope();
        var input = (ObjectNode) root.path("input");
        input.putObject("planningCalendarSource");
        assertEquals("CALENDAR_SOURCE_UNSUPPORTED", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        input.remove("planningCalendarSource");
        var person = (ObjectNode) input.path("employees").get(0);
        person.putObject("leadership").put("source","MANUAL");
        assertEquals("LEADERSHIP_UNSUPPORTED", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        person.remove("leadership");
        var segment = (ObjectNode) input.path("shifts").get(0).path("segments").get(0);
        segment.put("start",Integer.MAX_VALUE);
        assertEquals("CLOCK_RANGE", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
        segment.put("start",420);
        input.set("assignments",JSON.readTree("""
            [{"employeeId":"person-0","date":"2026-11-01","kind":"OFF","monthlyCarry":true}]
            """));
        assertEquals("ASSIGNMENT_METADATA_UNSUPPORTED", assertThrows(WireModel.Unsupported.class,
                () -> WireModel.read(root)).getMessage());
    }
    @Test void commonJavaRustWireContract() throws Exception {
        try (var source=getClass().getResourceAsStream("/e2-wire-contract.json")) {
            assertNotNull(source);
            var corpus=JSON.readTree(source);
            assertEquals("E2-WIRE-1",corpus.path("version").asText());
            for (var sample:corpus.path("cases")) {
                var value=corpus.path("base").deepCopy();
                String name=sample.path("name").asText();
                if (sample.has("pointer")) {
                    String pointer=sample.path("pointer").asText();
                    int split=pointer.lastIndexOf('/');
                    var target=(ObjectNode)value.at(pointer.substring(0,split));
                    target.set(pointer.substring(split+1),sample.path("value"));
                }
                if (sample.path("accept").asBoolean()) {
                    var model=assertDoesNotThrow(() -> WireModel.read(value),name);
                    assertEquals(7,model.days().size(),name);
                } else {
                    assertThrows(IllegalArgumentException.class,() -> WireModel.read(value),name);
                }
            }
        }
    }
    @Test void sharedCustomProfileCorpusUsesNativeSearch() throws Exception {
        try(var source=getClass().getResourceAsStream("/e3a-fixed-clock-contract.json")){
            assertNotNull(source);
            var corpus=JSON.readTree(source);
            assertEquals("E3A-FIXED-CLOCK-1",corpus.path("version").asText());
            var root=corpus.path("base");
            var roster=WireModel.read(root);
            assertEquals(PatternSeeder.Outcome.APPLIED,PatternSeeder.seed(roster,Long.MAX_VALUE));
            assertTrue(SeedGuard.install(roster));
            var factory=ai.timefold.solver.core.api.solver.SolverFactory.<Roster>create(
                SpikeMain.config(java.time.Duration.ofMillis(400)));
            var result=factory.buildSolver().solve(roster);
            assertTrue(result.score().isFeasible());
            assertEquals(21,result.days().size());
            for(int i=0;i<3;i++){
                final String id="person-"+i;
                var cells=result.days().stream().filter(day->day.person().equals(id)).toList();
                assertEquals(5,cells.stream().filter(Day::working).count());
                assertTrue(cells.getLast().working());
                int paid=cells.stream().filter(Day::working).flatMap(day->day.getWorkSegments().stream())
                    .mapToInt(segment->segment.end()-segment.start()).sum();
                assertEquals((40+2*i)*60,paid);
                assertTrue(cells.stream().filter(Day::working).allMatch(day->day.shift().equals("clock-"+(paid/60))));
                if(i==0){
                    assertTrue(cells.get(1).resting());
                    assertTrue(cells.get(0).resting()||cells.get(2).resting());
                }
                if(i==1)assertTrue(cells.get(2).resting()&&cells.get(5).resting());
            }
            for(var mutation:corpus.path("mutations")){
                var value=root.deepCopy();
                String pointer=mutation.path("pointer").asText();
                int split=pointer.lastIndexOf('/');
                ((ObjectNode)value.at(pointer.substring(0,split))).set(pointer.substring(split+1),mutation.path("value"));
                assertThrows(IllegalArgumentException.class,()->WireModel.read(value),mutation.path("name").asText());
            }
        }
    }
    @Test void rejectsLockedSaturdayOff() throws Exception {
        var root = envelope();
        ((ObjectNode)root.path("input")).set("assignments", JSON.readTree(
          "[{\"employeeId\":\"person-0\",\"date\":\"2026-11-07\",\"kind\":\"OFF\",\"locked\":true}]"));
        assertThrows(WireModel.Unsupported.class, () -> WireModel.read(root));
    }
}
