# Reference: validity checklist (`model-kikwi-process`)

> Loaded from [`../SKILL.md`](../SKILL.md) Step 6. Run through this before delivering the file — see also
> [`node-types.md`](node-types.md) for the field-level catalog these checks assume.

Two tiers, deliberately separated. **A** is what `kikwi-core`'s `DeployValidator` actually checks today — get
any of these wrong and `POST /process-definitions` throws `InvalidProcessDefinitionException` (or, for some
gateway/deploy-flag cases, a raw `500` — see the target project's REST testing notes if one exists). **B** is
*not* checked at deploy time in the current engine version — a definition violating these deploys successfully
and then breaks, stalls, or silently misbehaves at runtime. Model to satisfy both; only tier A is what "the
deploy will actually reject" means.

## A — Enforced today (will fail deploy)

- [ ] `EXECUTABLE_TASK.executor`, **if present**, resolves to a registered `TaskHandler` bean.
- [ ] `EXECUTABLE_TASK.boundaryEventIds` only reference `BOUNDARY_NON_INTERRUPTIVE_TIMER` or
      `BOUNDARY_ERROR_HANDLER` nodes.
- [ ] `EXCLUSIVE_GATEWAY.providerType` is `BEAN` or `VARIABLE` (never null/missing).
- [ ] If `providerType: BEAN` → `providerBean` non-blank and resolves to a registered `AnswerProvider` bean.
- [ ] If `providerType: VARIABLE` → `providerVariable` non-blank.
- [ ] An `EXCLUSIVE_GATEWAY` has **at most one** outgoing edge with `isDefault: true`.
- [ ] `CALL_ACTIVITY_COORDINATOR.calledElement` is non-blank.
- [ ] `CALL_ACTIVITY_COORDINATOR.elementVariable`, if present, has `collectionVariable` also present.
- [ ] `CALL_ACTIVITY_COORDINATOR.boundaryEventIds` only reference `BOUNDARY_INTERRUPTIVE_TIMER` or
      `BOUNDARY_NON_INTERRUPTIVE_TIMER` nodes (no error handler, no catch event).
- [ ] `EVENT_CATCHER`/`EVENT_THROWER`/`BOUNDARY_INTERRUPTIVE_CATCH_EVENT`: `providerType` is set, and the field
      required by that type is filled (`staticKey`/`providerVariable`/`providerBean` resolving to a real
      `CorrelationKeysProvider`/`correlationTemplates` non-empty).
- [ ] `EVENT_CATCHER` never combines `catchType: GROUP` with `providerType: STATIC`.
- [ ] `EVENT_CATCHER.boundaryEventIds` only reference `BOUNDARY_INTERRUPTIVE_TIMER` or
      `BOUNDARY_NON_INTERRUPTIVE_TIMER` nodes.
- [ ] `BOUNDARY_INTERRUPTIVE_CATCH_EVENT.attachedToRef` points to a node that is `EXTERNAL_TASK` or
      `TIMER_TASK` (never `EXECUTABLE_TASK`, never anything else).
- [ ] `TIMER_TASK.boundaryEventIds` only reference `BOUNDARY_INTERRUPTIVE_TIMER`,
      `BOUNDARY_NON_INTERRUPTIVE_TIMER`, or `BOUNDARY_INTERRUPTIVE_CATCH_EVENT` nodes (no error handler).

## B — Not enforced today, but still get it right

- [ ] `defaultStartPoint` exists in `flowNodes` and is a `DEFAULT_START_EVENT`.
- [ ] Every `flowNodes` key equals the `"id"` inside that node.
- [ ] Every `targetNodeId` (in `outgoing` or `targetJoinId`) resolves to an existing node — a dangling
      reference isn't rejected at deploy, it just fails or does nothing the moment that edge is actually taken.
- [ ] Every `DEFAULT_END_EVENT` has empty `outgoing`; every `DEFAULT_START_EVENT` has exactly one.
- [ ] Every node except `EXCLUSIVE_GATEWAY`/`PARALLEL_GATEWAY` has at most one `outgoing` entry.
- [ ] No two `EXCLUSIVE_GATEWAY` edges share an `expectedAnswer` (the engine takes the first match — a
      duplicate is a silently unreachable edge, not an error) or `handlesNull: true`.
- [ ] Every `PARALLEL_GATEWAY` declares `targetJoinId` pointing to an actual `JOIN_GATEWAY` — **this entire
      family (`PARALLEL_GATEWAY`/`JOIN_GATEWAY`) has zero deploy-time structural validation today**: a
      `targetJoinId` pointing nowhere, or to the wrong node type, deploys fine and breaks the fan-in at
      runtime. Double-check it by hand.
- [ ] Every `JOIN_GATEWAY` is reached **only** via a `PARALLEL_GATEWAY`'s `targetJoinId`, never a plain
      sequence flow — also unenforced, same reasoning.
- [ ] `EXTERNAL_TASK.boundaryEventIds` follow the [`node-types.md`](node-types.md) table (interruptive timer,
      non-interruptive timer, interruptive catch event; no error handler) even though — unlike every other
      host type — **`DeployValidator` has no branch for `EXTERNAL_TASK` at all today**, so nothing stops an
      incorrectly attached boundary from deploying. The individual boundary node's own `attachedToRef`-target
      check (where one exists, e.g. `BOUNDARY_INTERRUPTIVE_CATCH_EVENT`) is the only backstop.
- [ ] `BOUNDARY_INTERRUPTIVE_TIMER`/`TIMER_TASK`'s own `providerType` + matching value field
      (`staticValue`/`providerVariable`/`providerBean`) are actually filled in — not validated at deploy, fails
      when the timer is due to fire.
- [ ] `BOUNDARY_NON_INTERRUPTIVE_TIMER.schedulePolicy` is present with the field its `type` requires — same,
      unvalidated at deploy.
- [ ] `BOUNDARY_ERROR_HANDLER.attachedToRef` points to an `EXECUTABLE_TASK` (the only host it makes semantic
      sense on), and no two handlers on the same parent share an `errorCode` (or both omit it, i.e. two
      wildcards) — neither is checked today.
- [ ] `retryPolicy`, if present, has a real `strategy` and the fields that strategy needs
      (`intervals` for `LINEAR`, `initialInterval` for `EXPONENTIAL_BACKOFF`) — unvalidated at deploy.
- [ ] Every node in `flowNodes` is reachable from `defaultStartPoint` — no orphaned nodes nothing points to.
- [ ] Every `executor`/`providerBean` either matches a real bean found in Step 4, or is listed as a component
      to implement in the delivery (Step 7) — never a silent dangling reference.
