package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.score.BendableScore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WeeklySwapSearchTest {
    private static Day day(String person,int index,boolean pinned,Day.State state) {
        return new Day(person,"S","Caixa","clock",index,"2026-11-"+String.format("%02d",index+1),
                List.of(new Day.Segment(420,660),new Day.Segment(780,1044)),
                pinned,pinned,state,state,null);
    }

    @Test void selectorKeepsWeekPersonAndPins() {
        Day first=day("person-0",0,false,Day.State.WORK);
        assertTrue(WeeklySwapSearch.sameMovableWeek(first,day("person-0",1,false,Day.State.OFF)));
        assertFalse(WeeklySwapSearch.sameMovableWeek(first,day("person-0",7,false,Day.State.OFF)));
        assertFalse(WeeklySwapSearch.sameMovableWeek(first,day("person-1",1,false,Day.State.OFF)));
        assertFalse(WeeklySwapSearch.sameMovableWeek(first,day("person-0",1,true,Day.State.OFF)));
        assertFalse(WeeklySwapSearch.sameMovableWeek(first,first));
    }

    @Test void actualNativeSwapSearchDoesNotBreakLegalWeek() {
        var cells=new ArrayList<Day>();
        for(int i=0;i<7;i++) cells.add(day("person-0",i,i==6,i==0||i==3?Day.State.OFF:Day.State.WORK));
        var roster=new Roster(cells,List.of(new Roster.Window("person-0",0,6,1,Day.State.WORK,5,5)),
                List.of(new Roster.Band(0,"S",null,480,540,1,true)));
        var config=SpikeMain.config(Duration.ofMillis(250));
        WeeklySwapSearch.configure(config);
        var factory=SolverFactory.<Roster>create(config);
        var checker=SolutionManager.<Roster,BendableScore>create(factory);
        var before=checker.update(roster);
        assertTrue(before.isFeasible());
        var solved=factory.buildSolver().solve(roster);
        assertTrue(solved.score().isFeasible());
        assertTrue(solved.score().compareTo(before)>=0);
        assertEquals(5,solved.days().stream().filter(Day::working).count());
        assertTrue(solved.days().get(6).working());
        assertEquals(solved.score(),checker.update(solved));
    }
}
