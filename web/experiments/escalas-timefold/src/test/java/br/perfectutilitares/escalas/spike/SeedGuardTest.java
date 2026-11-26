package br.perfectutilitares.escalas.spike;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SeedGuardTest {
    private static Day day(Day.State state) {
        return new Day("person-0", "S", "Repositor", "clock", 0, "2026-11-01",
                List.of(new Day.Segment(420, 660)), false, null, null, state, null);
    }
    @Test void freezesOnlyOwnCompleteFeasibleCoverage() {
        var roster = new Roster(List.of(day(Day.State.WORK)), List.of(),
                List.of(new Roster.Band(0, "S", null, 480, 540, 2, true)));
        assertTrue(SeedGuard.install(roster));
        assertEquals(List.of(new Roster.SectorLimit("S", 60, 60, 1)), roster.getSectorLimits());
        assertEquals(List.of(new Roster.ServiceLimit("S", 0)), roster.getServiceLimits());
    }
    @Test void neverFreezesAnUninitializedOrConfirmedInfeasibleSeed() {
        var uninitialized = new Roster(List.of(day(null)), List.of(), List.of());
        assertFalse(SeedGuard.install(uninitialized));
        var deficit = new Roster(List.of(day(Day.State.OFF)), List.of(),
                List.of(new Roster.Band(0, "S", null, 480, 540, 1, false)));
        assertFalse(SeedGuard.install(deficit));
        assertTrue(deficit.getSectorLimits().isEmpty());
        assertTrue(deficit.getServiceLimits().isEmpty());
    }
}
