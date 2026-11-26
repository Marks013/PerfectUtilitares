package br.perfectutilitares.escalas.spike;

import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.entity.PlanningPin;
import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import static org.junit.jupiter.api.Assertions.*;

/** Early, independent structural check before ConstraintVerifier constructs the model. */
class DomainAccessTest {
    @Test void everyAnnotatedPrivateFieldHasPublicBeanAccess() throws Exception {
        // The exact properties currently annotated; the loop checks all declared
        // fields, including new annotations added in later increments.
        assertEquals(Set.of("states", "windows", "bands", "sectorLimits", "serviceLimits", "days", "score"), annotated(Roster.class));
        assertEquals(Set.of("id", "pinned", "state"), annotated(Day.class));
        for (Class<?> type : List.of(Roster.class, Day.class)) {
            assertTrue(Modifier.isPublic(type.getConstructor().getModifiers()));
            // Also check non-annotated instance fields used when cloning.
            for (var field : type.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || field.isSynthetic()) continue;
                String name = field.getName();
                String suffix = Character.toUpperCase(name.charAt(0)) + name.substring(1);
                String getterName = field.getType() == boolean.class ? "is" + suffix : "get" + suffix;
                var getter = type.getMethod(getterName);
                var setter = type.getMethod("set" + suffix, field.getType());
                assertTrue(Modifier.isPublic(getter.getModifiers()), name);
                assertEquals(field.getType(), getter.getReturnType(), name);
                assertTrue(Modifier.isPublic(setter.getModifiers()), name);
                assertEquals(void.class, setter.getReturnType(), name);
            }
        }
    }

    private static Set<String> annotated(Class<?> type) {
        return Arrays.stream(type.getDeclaredFields()).filter(field ->
                field.isAnnotationPresent(PlanningId.class) || field.isAnnotationPresent(PlanningPin.class)
                || field.isAnnotationPresent(PlanningVariable.class)
                || field.isAnnotationPresent(PlanningScore.class)
                || field.isAnnotationPresent(ProblemFactCollectionProperty.class)
                || field.isAnnotationPresent(PlanningEntityCollectionProperty.class)
                || field.isAnnotationPresent(ValueRangeProvider.class))
                .map(java.lang.reflect.Field::getName).collect(Collectors.toSet());
    }
}
