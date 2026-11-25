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
          [{"date":"2026-11-01","sector":"S","start":480,"end":540,"minimum":2,"estimated":true},
           {"date":"2026-11-01","sector":"S","role":"Caixa","start":480,"end":540,"minimum":1,"estimated":true},
           {"date":"2026-11-01","sector":"S","role":"Caixa","start":510,"end":540,"minimum":1,"estimated":true},
           {"date":"2026-11-01","sector":"S","role":"Repositor","start":480,"end":540,"minimum":1,"estimated":true}]
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
        assertThrows(WireModel.Unsupported.class, () -> WireModel.read(root));
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
    @Test void rejectsLockedSaturdayOff() throws Exception {
        var root = envelope();
        ((ObjectNode)root.path("input")).set("assignments", JSON.readTree(
          "[{\"employeeId\":\"person-0\",\"date\":\"2026-11-07\",\"kind\":\"OFF\",\"locked\":true}]"));
        assertThrows(WireModel.Unsupported.class, () -> WireModel.read(root));
    }
}
