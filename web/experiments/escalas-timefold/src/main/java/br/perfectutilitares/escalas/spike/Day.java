package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.entity.PlanningPin;
import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

import java.util.List;

/** A daily decision. Fixed clocks and immutable geometry are not planning variables. */
@PlanningEntity
public class Day {
    public enum State { WORK, OFF }
    public record Segment(int start, int end) {}
    public record PatternKey(String person, int weekday, int weeks) {}
    @PlanningId
    private String id;
    private String person;
    private String sector;
    private String role;
    private String shift;
    private int index;
    private String date;
    private List<Segment> workSegments;
    @PlanningPin
    private boolean pinned;
    private Boolean originalLocked;
    private State saved;
    private PatternKey patternKey;

    @PlanningVariable(valueRangeProviderRefs = "states")
    private State state;

    public Day() {}

    Day(String person, String sector, String role, String shift, int index, String date,
            List<Segment> workSegments, boolean pinned, Boolean originalLocked,
            State saved, State initial, PatternKey patternKey) {
        this.id = person + "/" + date;
        this.person = person;
        this.sector = sector;
        this.role = role;
        this.shift = shift;
        this.index = index;
        this.date = date;
        this.workSegments = List.copyOf(workSegments);
        this.pinned = pinned;
        this.originalLocked = originalLocked;
        this.saved = saved;
        this.state = initial;
        this.patternKey = patternKey;
    }

    public String id() { return id; }
    public String person() { return person; }
    public String sector() { return sector; }
    public String role() { return role; }
    public String shift() { return shift; }
    public String date() { return date; }
    public int index() { return index; }
    public boolean isPinned() { return pinned; }
    public Boolean originalLocked() { return originalLocked; }
    public State saved() { return saved; }
    public State state() { return state; }
    public void setState(State state) { this.state = state; }
    public boolean working() { return state == State.WORK; }
    public boolean resting() { return state == State.OFF; }
    public PatternKey patternKey() { return patternKey; }
    public boolean covers(int start, int end) {
        return workSegments.stream().anyMatch(s -> s.start() <= start && s.end() >= end);
    }
}
