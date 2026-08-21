package com.example.expenseapproval.handlers;

import io.kikwiflow.execution.api.ExecutionContext;
import io.kikwiflow.execution.api.TaskHandler;
import org.springframework.stereotype.Component;

/**
 * Implements the "VALIDATE" node's {@code executor} from
 * ../../model-kikwi-process/examples/expense-approval.kikwi.json ("Validate Expense Data").
 *
 * <p>Generated per the {@code implement-kikwi-components} skill's "wire correctly, guess nothing"
 * rule (see its SKILL.md, Step 4): the spec behind that node only ever said "the system validates
 * the data" — no concrete rule (which fields, which format, what makes an expense report invalid)
 * was ever stated anywhere available to this generator. The bean name and the {@code TaskHandler}
 * signature below are certain and fully wired; the actual validation rule is not, so it's left as
 * a loud, unmissable failure instead of a guessed-at implementation.
 */
@Component("expenseValidationTaskHandler")
public class ExpenseValidationTaskHandler implements TaskHandler {

    @Override
    public void handle(ExecutionContext execution) {
        // TODO(kikwiflow): the source spec only said "the system validates the data" — no concrete
        // validation rule (required fields, amount limits, category/policy checks, etc.) was ever
        // stated. Confirm the real rule with whoever owns the expense-approval process, then:
        //   1. Read whatever process variables the rule needs via execution.getVariable(...).
        //   2. On an invalid report, throw a ProcessErrorException with a real errorCode instead of
        //      UnsupportedOperationException — but only once a BOUNDARY_ERROR_HANDLER for that
        //      errorCode is actually attached to this node in the .kikwi (see the skill's Step 5).
        //   3. Remove this exception once the rule above is implemented and tested.
        throw new UnsupportedOperationException(
                "expenseValidationTaskHandler: validation rule not yet specified — see TODO above");
    }
}
