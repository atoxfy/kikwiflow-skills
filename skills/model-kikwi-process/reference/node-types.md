# Reference: node type catalog (`model-kikwi-process`)

> Loaded from [`../SKILL.md`](../SKILL.md) Step 3. Consult this file per node type as you build the
> graph — field names below are transcribed from the actual `record`s in `kikwi-model`, not the prose
> docs, which can drift. See also [`validation-checklist.md`](validation-checklist.md) for what's
> actually enforced at deploy time.

## Node type catalog and required fields

| `type` | Fields beyond the common set | Notes |
|---|---|---|
| `DEFAULT_START_EVENT` | — | Exactly one `outgoing`. |
| `DEFAULT_END_EVENT` | — | `outgoing` always empty. One per distinct terminal outcome the spec names. |
| `EXECUTABLE_TASK` | `executor` (string), `retryPolicy` (optional, see below) | Synchronous in-process logic. `boundaryEventIds` allowed. |
| `EXTERNAL_TASK` | — (no `executor`) | Waits on something outside the engine's direct control. `boundaryEventIds` allowed. |
| `EXCLUSIVE_GATEWAY` | `providerType` (`BEAN`/`VARIABLE`), `providerBean`, `providerVariable`, `defaultFlow` (informational) | See routing rules below. No `boundaryEventIds`. |
| `PARALLEL_GATEWAY` | `targetJoinId` | Opens simultaneous branches. No `boundaryEventIds`. |
| `JOIN_GATEWAY` | `sourceSplitId` (informational) | Closes branches. Reached only via a `PARALLEL_GATEWAY`'s `targetJoinId`. |
| `BOUNDARY_INTERRUPTIVE_TIMER` | `attachedToRef`, `providerType` (`STATIC`/`VARIABLE`/`BEAN`), `staticValue`/`providerVariable`/`providerBean` matching that type | Cancels the parent's wait when it fires. |
| `BOUNDARY_NON_INTERRUPTIVE_TIMER` | `attachedToRef`, `schedulePolicy` (see below) | Only notifies, doesn't cancel. |
| `BOUNDARY_ERROR_HANDLER` | `attachedToRef`, `errorCode` (optional — omitted means wildcard) | Catches a business error from the parent. |
| `BOUNDARY_INTERRUPTIVE_CATCH_EVENT` | `attachedToRef`, correlation fields (see below) | Cancels the parent via external correlation, not a deadline. |
| `TIMER_TASK` | `providerType` (`STATIC`/`VARIABLE`/`BEAN`), `staticValue`/`providerVariable`/`providerBean` | A deadline as the flow's own next step. `boundaryEventIds` allowed. |
| `EVENT_CATCHER` | `catchType` (`STANDALONE`/`GROUP`), `matchPolicy` (`ALL`/`ANY`, only meaningful in `GROUP`), correlation fields (see below) | Reactive wait for a correlation key. `boundaryEventIds` allowed. |
| `EVENT_THROWER` | Correlation fields (see below) | Fires a correlation key outward. No `boundaryEventIds`. |
| `CALL_ACTIVITY_COORDINATOR` | `calledElement`, `collectionVariable`/`elementVariable` (optional, batch only), `iterationMode` (`PARALLEL`/`SEQUENTIAL`, `null` behaves as `PARALLEL`) | Delegates to another process. `boundaryEventIds` allowed. |

## Correlation fields (shared shape — `EVENT_CATCHER`, `EVENT_THROWER`, `BOUNDARY_INTERRUPTIVE_CATCH_EVENT`)

All three implement the same `providerType` contract, now with **four** options (one more than the timer
provider types):

| `providerType` | Required field(s) |
|---|---|
| `STATIC` | `staticKey` (a fixed string — not `staticValue`, that name is reserved for timer due-dates) |
| `VARIABLE` | `providerVariable` |
| `BEAN` | `providerBean` — must resolve to a registered `CorrelationKeysProvider` bean |
| `TEMPLATE` | `correlationTemplates` — a list of `{ keySegments, displayNameSegments }`, built for scenarios where the correlation key is assembled from multiple fixed/variable segments rather than one field |

`keyPrefix`/`keySuffix`/`displayNamePrefix`/`displayNameSuffix` are optional cosmetic/technical modifiers on
top of whichever provider type is chosen. `EVENT_CATCHER` in `catchType: GROUP` cannot use `providerType:
STATIC` — `STATIC` always resolves to exactly one key, which is incompatible with waiting on a group of keys
(use `VARIABLE`, `BEAN`, or `TEMPLATE` instead).

`EVENT_THROWER` has no fire-and-forget mode: if no active `EVENT_CATCHER` is currently waiting on the key it
resolves, the node fails outright (same technical retry/incident path as any other node failure) — it does not
have a `boundaryEventIds` field at all, so a `BOUNDARY_ERROR_HANDLER` isn't an option here. If the spec implies
best-effort emission ("notify if anyone's listening"), that's a gap to flag in Step 7, not something modelable
with today's node set.

## Where boundary events can attach (`boundaryEventIds`)

Nodes that accept boundary events declare `"boundaryEventIds": ["ID_1", "ID_2"]`; each boundary node points
back via `"attachedToRef": "PARENT_ID"`. The allowed combination differs per host type — this table is the
real allowlist enforced by `kikwi-core`'s `DeployValidator` (see [`validation-checklist.md`](validation-checklist.md)
for what "enforced" means precisely):

| Parent | Interruptive timer | Non-interruptive timer | Error handler | Interruptive catch event |
|---|---|---|---|---|
| `EXECUTABLE_TASK` | ❌ | ✅ | ✅ | ❌ |
| `EXTERNAL_TASK` | ✅ (by design — see the validation checklist's gap note) | ✅ (by design) | ❌ | ✅ (by design) |
| `CALL_ACTIVITY_COORDINATOR` | ✅ | ✅ | ❌ | ❌ |
| `EVENT_CATCHER` | ✅ | ✅ | ❌ | ❌ |
| `TIMER_TASK` | ✅ | ✅ | ❌ | ✅ |

The reasoning to keep in mind while modeling: a node that runs a synchronous handler with a real side effect
(`EXECUTABLE_TASK`) has no safe point to interrupt from outside mid-call, so its only escape hatch is
`try/catch` (`BOUNDARY_ERROR_HANDLER`). Everything else in this table is a pure wait with no handler of its own
to protect, so it can be cancelled from outside (timer or event) but has nothing to synchronously `catch` a
business exception from.

## `EXCLUSIVE_GATEWAY` routing rules

Priority order — get this right, it's the most common source of a subtly wrong model:

1. If the resolved decision is `null` → follow the edge with `handlesNull: true` (declare at most one).
2. Otherwise → follow the first edge whose `expectedAnswer` matches exactly (string comparison). Don't give two
   edges of the same gateway the same `expectedAnswer` — the engine takes the first match, so a duplicate is a
   silently-dead second edge, not an error.
3. If none match → follow the edge with `isDefault: true` (**at most one** — this one *is* enforced, see the
   validation checklist).

**Model both a default and a null-handling edge whenever the spec's decision logic isn't provably exhaustive**
— an unhandled decision value with no matching edge silently stalls the instance at that gateway.

## `retryPolicy` (optional, on `EXECUTABLE_TASK`)

```json
{ "strategy": "EXPONENTIAL_BACKOFF", "maxRetries": 3, "initialInterval": "PT10S", "multiplier": 2.0, "maxInterval": "PT5M", "intervals": [] }
```
`strategy` is `LINEAR` or `EXPONENTIAL_BACKOFF`. For `LINEAR`, populate `intervals` (a list of duration
strings, one per retry attempt). For `EXPONENTIAL_BACKOFF`, populate `initialInterval` (and optionally
`multiplier`/`maxInterval`). If omitted entirely, the node falls back to the engine's built-in default (3
retries, no config knob to change that default globally).

## `schedulePolicy` (required on `BOUNDARY_NON_INTERRUPTIVE_TIMER`)

```json
{ "type": "RATE_DURATION", "expression": "PT24H", "fixedDates": [], "maxOccurrences": null }
```
`type` is `RATE_DURATION` (recurring interval, needs `expression`), `FIXED_DATES` (needs `fixedDates`, a list
of ISO timestamps), or `CRON` (a cron `expression`). `maxOccurrences` is an optional 1-based cap on how many
times the reminder fires (`null` = fires indefinitely as long as the parent node is still waiting).
