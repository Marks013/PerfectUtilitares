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

    // Timefold 2.x resolves annotated private fields through public JavaBean
    // accessors. Keep the domain's convenient readers as delegating aliases.
    // Non-planning properties are only populated at construction/cloning;
    // the optimizer is allowed to change state, never these facts or pins.
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getPerson() { return person; }
    public void setPerson(String person) { this.person = person; }
    public String getSector() { return sector; }
    public void setSector(String sector) { this.sector = sector; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getShift() { return shift; }
    public void setShift(String shift) { this.shift = shift; }
    public int getIndex() { return index; }
    public void setIndex(int index) { this.index = index; }
    public String getDate() { return date; }
    public void setDate(String date) { this.date = date; }
    public List<Segment> getWorkSegments() { return workSegments; }
    public void setWorkSegments(List<Segment> workSegments) { this.workSegments = List.copyOf(workSegments); }
    public boolean isPinned() { return pinned; }
    public void setPinned(boolean pinned) { this.pinned = pinned; }
    public Boolean getOriginalLocked() { return originalLocked; }
    public void setOriginalLocked(Boolean originalLocked) { this.originalLocked = originalLocked; }
    public State getSaved() { return saved; }
    public void setSaved(State saved) { this.saved = saved; }
    public PatternKey getPatternKey() { return patternKey; }
    public void setPatternKey(PatternKey patternKey) { this.patternKey = patternKey; }
    public State getState() { return state; }
    public void setState(State state) { this.state = state; }

    public String id() { return getId(); }
    public String person() { return getPerson(); }
    public String sector() { return getSector(); }
    public String role() { return getRole(); }
    public String shift() { return getShift(); }
    public String date() { return getDate(); }
    public int index() { return getIndex(); }
    public Boolean originalLocked() { return getOriginalLocked(); }
    public State saved() { return getSaved(); }
    public State state() { return getState(); }
    public boolean working() { return state == State.WORK; }
    public boolean resting() { return state == State.OFF; }
    public PatternKey patternKey() { return getPatternKey(); }
    public boolean covers(int start, int end) {
        return workSegments.stream().anyMatch(s -> s.start() <= start && s.end() >= end);
    }
}
