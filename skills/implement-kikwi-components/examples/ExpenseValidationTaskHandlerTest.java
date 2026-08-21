package com.example.expenseapproval.handlers;

import io.kikwiflow.execution.api.ExecutionContext;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

/**
 * Deliberately minimal: the handler under test has no real validation rule to assert yet (see the
 * TODO in {@link ExpenseValidationTaskHandler}). Asserting a specific passing behavior here would
 * fabricate coverage for logic nobody has specified — exactly what the {@code implement-kikwi-
 * components} skill's Step 6 says not to do. This test only documents the current (intentional)
 * state: the handler fails loudly instead of silently no-op'ing.
 *
 * <p>Replace this whole test once the real validation rule is implemented — it should then assert
 * both the rejection path (invalid report -> the real {@code ProcessErrorException}/{@code errorCode})
 * and the acceptance path, not the placeholder below.
 */
class ExpenseValidationTaskHandlerTest {

    @Test
    void todo_failsLoudlyUntilTheRealValidationRuleIsSpecified() {
        ExecutionContext execution = mock(ExecutionContext.class);

        assertThrows(
                UnsupportedOperationException.class,
                () -> new ExpenseValidationTaskHandler().handle(execution));
    }
}
