package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.config.heuristic.selector.move.generic.SwapMoveSelectorConfig;
import ai.timefold.solver.core.config.localsearch.LocalSearchPhaseConfig;
import ai.timefold.solver.core.config.localsearch.LocalSearchType;
import ai.timefold.solver.core.config.solver.SolverConfig;
import ai.timefold.solver.core.impl.heuristic.selector.common.decorator.SelectionFilter;
import ai.timefold.solver.core.impl.heuristic.selector.move.generic.SelectorBasedSwapMove;
import ai.timefold.solver.core.impl.score.director.ScoreDirector;
import ai.timefold.solver.core.preview.api.move.Move;

/** Opt-in, pinned Timefold 2.8 diagnostic: a two-cell native swap within
 * one person's week preserves its WORK count. Do not use a single-cell
 * change selector to refine an already complete 5x2 seed.
 * Other hard rules and sector guards remain in the score director.
 * The version-specific filter deliberately uses the swap selector's concrete
 * type; no reflection, JNI or unbounded cached move list.
 */
public final class WeeklySwapSearch implements SelectionFilter<Roster, Move<Roster>> {
    public WeeklySwapSearch() {}

    static boolean sameMovableWeek(Day left, Day right) {
        return left != right && !left.isPinned() && !right.isPinned()
                && left.person().equals(right.person()) && left.index()/7 == right.index()/7;
    }

    @Override
    public boolean accept(ScoreDirector<Roster> director, Move<Roster> move) {
        return move instanceof SelectorBasedSwapMove<?> swap
                && swap.getLeftEntity() instanceof Day left
                && swap.getRightEntity() instanceof Day right && sameMovableWeek(left,right);
    }

    static void configure(SolverConfig config) {
        config.withPhases(new LocalSearchPhaseConfig()
                .withLocalSearchType(LocalSearchType.LATE_ACCEPTANCE)
                .withMoveSelectorConfig(new SwapMoveSelectorConfig()
                        .withVariableNameIncludes("state").withFilterClass(WeeklySwapSearch.class)));
    }
}
