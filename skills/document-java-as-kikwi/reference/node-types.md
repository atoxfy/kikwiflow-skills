# Reference: node type catalog (`document-java-as-kikwi`)

> Loaded from [`../SKILL.md`](../SKILL.md) Step 3. Consult this file per node type as you build the
> graph. See also [`validation-checklist.md`](validation-checklist.md) for the structural checklist to
> run before delivering.

Use exactly these 15 values in the `"type"` field — don't invent new types.

| `type` | When to use it | Relevant extra fields |
|---|---|---|
| `DEFAULT_START_EVENT` | One per process, pointed to via `defaultStartPoint` | — |
| `DEFAULT_END_EVENT` | Every terminal path. `outgoing` is always empty | — |
| `EXECUTABLE_TASK` | Synchronous in-process logic (calculation, validation, transformation, quick call) | `executor` (descriptive name, see Step 4) |
| `EXTERNAL_TASK` | Waits on something outside the flow's direct control (a human, an external worker, a queue) | — (no `executor`) |
| `EXCLUSIVE_GATEWAY` | Decision — follows **one** path among several | `providerType` (`BEAN`/`VARIABLE`) + `providerBean` or `providerVariable` |
| `PARALLEL_GATEWAY` | Opens multiple simultaneous branches | `targetJoinId` (points to the matching `JOIN_GATEWAY`) |
| `JOIN_GATEWAY` | Closes the branches opened by the matching `PARALLEL_GATEWAY` | `sourceSplitId` (informational) |
| `BOUNDARY_INTERRUPTIVE_TIMER` | A deadline that, when it expires, cancels the parent node's wait and reroutes the flow | `attachedToRef`, `providerType` (`STATIC`/`VARIABLE`/`BEAN`) + `staticValue`/`providerVariable`/`providerBean` |
| `BOUNDARY_NON_INTERRUPTIVE_TIMER` | A recurring deadline that only notifies, without canceling the parent node | `attachedToRef`, `schedulePolicy` |
| `BOUNDARY_ERROR_HANDLER` | Catches an expected business error from the parent node | `attachedToRef`, `errorCode` (optional — without it, it's a wildcard) |
| `BOUNDARY_INTERRUPTIVE_CATCH_EVENT` | Cancels the parent node via an external correlation (not a deadline) | `attachedToRef`, same correlation fields as `EVENT_CATCHER` |
| `TIMER_TASK` | Waits on a deadline as the main flow's own next step (not attached to another node) | `providerType` + `staticValue`/`providerVariable`/`providerBean` |
| `EVENT_CATCHER` | Reactive wait for an external correlation key (webhook, callback) | `catchType` (`STANDALONE`/`GROUP`), `providerType`, `matchPolicy` (only in `GROUP`) |
| `EVENT_THROWER` | Fires/publishes a correlation key outward (the emitting counterpart of `EVENT_CATCHER`) | same correlation fields as `EVENT_CATCHER`, no `catchType`/`matchPolicy` |
| `CALL_ACTIVITY_COORDINATOR` | Calls another process/module as its own business unit; or processes a list in batch | `calledElement`, `collectionVariable`/`elementVariable` (optional, batch only), `iterationMode` (`PARALLEL`/`SEQUENTIAL`; `PARALLEL` if omitted — use `SEQUENTIAL` when the code processes the batch one item at a time with an ordering dependency) |

## Where each boundary event (`boundaryEventIds`) can be attached

Nodes that accept boundary events declare `"boundaryEventIds": ["EVENT_ID_1", "EVENT_ID_2"]`, and each boundary
event references back via `"attachedToRef": "PARENT_NODE_ID"`. Not every combination is valid:

| Parent node | Interruptive timer | Non-interruptive timer | Error handler | Correlation catch event |
|---|---|---|---|---|
| `EXECUTABLE_TASK` | ❌ Not allowed | ✅ | ✅ | ❌ Not allowed |
| `EXTERNAL_TASK` | ✅ | ✅ | ❌ | ✅ |
| `TIMER_TASK` | ✅ | ✅ | ❌ | ✅ |
| `EVENT_CATCHER` | ✅ | ✅ | ❌ | ❌ |
| `CALL_ACTIVITY_COORDINATOR` | ✅ (timers only) | ✅ (timers only) | ❌ | ❌ |

Practical reason (document this if the real process has this shape): an `EXECUTABLE_TASK` runs its handler
synchronously — there's no way to "cancel from outside" mid-call without risking a side effect having already
happened. A business error on it is always `try/catch` (`BOUNDARY_ERROR_HANDLER`), never an asynchronous
interruption.

## `EXCLUSIVE_GATEWAY`: routing rules

A decision gateway's routing follows this priority order — reflect the real Java logic faithfully when
deciding each edge's `expectedAnswer`/`isDefault`/`handlesNull`:

1. If the resolved decision is `null` → follow the edge with `handlesNull: true` (at most one per gateway).
2. Otherwise → follow the first edge whose `expectedAnswer` matches the decision exactly (string comparison).
3. If none match → follow the edge with `isDefault: true` (at most one per gateway).
