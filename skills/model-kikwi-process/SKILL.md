---
name: model-kikwi-process
description: >
  Turns a natural-language specification (a user story, a requirements doc, a description of a business
  process someone types out loud) into a Kikwiflow process definition — a `.kikwi` JSON file with the right
  node types and valid sequence flows, ready to be implemented and deployed. Layout coordinates are left
  zeroed and handed off to the separate `beautify-kikwi-diagram` skill, so this skill can focus entirely on
  structural correctness. Trigger this skill when asked to "model", "design", or "create a process/flow" for
  Kikwiflow from a description of desired behavior. This is the mirror image of `document-java-as-kikwi`
  (which reads *existing code*, documentation-only, never meant to run) — this skill starts from *intent*, not
  code, and its output is meant to become real: `executor`/`providerBean` values should resolve to actual
  beans (existing or to be built), not just be readable labels, and the JSON must match the exact field names
  the engine deserializes (`ProcessDefinitionDeployRequest`/`FlowNodeDefinition` in `kikwi-model`), not an
  approximation of them.
---

# Skill: Model a Kikwiflow process from a natural-language spec

> See also: [`document-java-as-kikwi`](../document-java-as-kikwi/SKILL.md) — the mirror skill, for
> documenting an *existing* Java project as a `.kikwi` instead of modeling one from intent — and
> [`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md), the separate follow-up pass that
> computes readable `layout` coordinates once this skill's graph is structurally done.
>
> Bundled reference material, loaded on demand as each step below points to it:
> [`reference/node-types.md`](reference/node-types.md) (full node type catalog, Step 3) and
> [`reference/validation-checklist.md`](reference/validation-checklist.md) (deploy-validity checklist,
> Step 6). A worked example lives at
> [`examples/expense-approval.kikwi.json`](examples/expense-approval.kikwi.json).
>
> New here? See the [repo tutorial](../../TUTORIAL.md) for a full worked prompt → output walkthrough,
> including chaining this skill's output into `beautify-kikwi-diagram`.

## What Kikwiflow is (context needed before you start)

Kikwiflow is a process orchestration engine (workflow/BPM) built in Java, with one central difference from
traditional engines (Camunda, Activiti, jBPM): **it is not based on BPMN XML and does not use an expression
language** (no embedded SpEL/JUEL/FEEL). A process is a **graph of nodes described in JSON** — the `.kikwi`
file — and the logic of each node (decision, task) is, in a real application, a plain Java class registered as
a Spring bean and referenced by name (`executor` on `EXECUTABLE_TASK`, `providerBean` on `EXCLUSIVE_GATEWAY`
with `providerType: BEAN`, etc.).

## When to use this skill, and how it differs from `document-java-as-kikwi`

Use this skill when the starting point is **a description of what should happen**, not code that already
exists — "model an onboarding process where...", "design the flow for handling a return request...", a
paragraph or ticket describing steps/decisions/waits. If a companion `document-java-as-kikwi` skill is present
in this project, note the asymmetry: that skill reads code and produces a diagram that is **never meant to run**
(bean names are just descriptive labels, and its JSON shape is a simplified approximation good enough for the
visual editor). This skill goes the other way and its output **is meant to become real**:

- `executor` / `providerBean` values should, wherever possible, be resolved against beans that **actually
  exist** in the target project (see Step 4). Where no matching bean exists, that's not a blocker — it's a
  concrete, named TODO you hand back at the end (Step 7), not something to gloss over.
- The JSON must use the **exact field names** the engine's Jackson mapping expects (Step 2, and
  [`reference/node-types.md`](reference/node-types.md), are transcribed directly from `kikwi-model`'s
  `record`s, not paraphrased from prose docs) and pass real deploy-time validation
  ([`reference/validation-checklist.md`](reference/validation-checklist.md) is grounded in `kikwi-core`'s
  `DeployValidator` source, split explicitly between what actually blocks a deploy today and what doesn't but
  will still break the process at runtime).

## Step 1 — Read the spec and build the flow skeleton

Before writing any JSON, extract the step list from the spec. Map business-language cues to node types:

| What the spec says (business language) | Becomes |
|---|---|
| "the process starts when...", "a request arrives...", a trigger condition | `DEFAULT_START_EVENT` |
| "the system does X automatically", "calculates", "validates", "transforms" (fast, in-process, no waiting on anyone) | `EXECUTABLE_TASK` |
| "wait for approval from...", "an operator/analyst reviews...", "assigned to a team", "a human decides" | `EXTERNAL_TASK` |
| "if / depending on / when X, then... otherwise...", any branching business rule | `EXCLUSIVE_GATEWAY` |
| "at the same time...", "in parallel...", "simultaneously do X and Y, then proceed once both are done" | `PARALLEL_GATEWAY` (opens) + `JOIN_GATEWAY` (closes) |
| "within N hours/days, if there's no response, do Z" (and Z **replaces** the wait) | `BOUNDARY_INTERRUPTIVE_TIMER` attached to the task being waited on |
| "after N hours, send a reminder" (and the original wait **keeps going**) | `BOUNDARY_NON_INTERRUPTIVE_TIMER` |
| "if this fails/is rejected for reason Y, do Z" (an *expected* business outcome, not a bug) | `BOUNDARY_ERROR_HANDLER` attached to the failing task |
| "wait N days before the next step" as the flow's own next step (not attached to another wait) | `TIMER_TASK` |
| "wait for an external notification/webhook/callback identified by X" | `EVENT_CATCHER` |
| "notify/publish/emit event X to other systems" | `EVENT_THROWER` |
| "delegate to process Y as a sub-step", "for each item in the list, run process Y" | `CALL_ACTIVITY_COORDINATOR` |
| "the process ends", "request is completed/rejected/cancelled" (every distinct terminal outcome) | `DEFAULT_END_EVENT` |

Model at the **business step** level a domain expert would recognize if you narrated the flow out loud — don't
turn every trivial detail the spec mentions into its own node.

### Business errors: `BOUNDARY_ERROR_HANDLER`, never `EXCLUSIVE_GATEWAY`

This is the single most common modeling mistake: given "if this fails/is rejected for reason Y, do Z", it's
tempting to bolt an `EXCLUSIVE_GATEWAY` onto the end of the failing task and switch on the failure reason. Don't.
`EXCLUSIVE_GATEWAY` routes on a value that has **already been resolved** — an `AnswerProvider` bean or a process
variable, something computed successfully. It has no concept of "this task threw an exception" as an input. A
gateway placed after a task that can fail either never gets reached (the task never returned to feed it a value)
or forces the task's handler to swallow the failure and manufacture a fake "answer" describing it — which just
relocates the same problem one node downstream instead of solving it.

The actual mechanism for "this failed for reason Y, do Z" is a `BOUNDARY_ERROR_HANDLER` attached to the task via
`attachedToRef`, matching on `errorCode`. And critically: **a "switch by failure reason" is modeled by attaching
multiple `BOUNDARY_ERROR_HANDLER`s to the same `EXECUTABLE_TASK`, one per `errorCode`, each with its own
`outgoing`** — that multiplicity *is* the switch, there's no gateway involved at any point:

- `errorCode` omitted (`null`) on a handler makes it a **wildcard** — it catches any error the task raises that no
  more specific handler already matched. Declare at most one wildcard handler per task; use it as a generic
  fallback, not as your only handler when the spec actually distinguishes failure reasons.
- Don't repeat the same `errorCode` across two handlers on the same task — matching takes the first one found, so
  a duplicate is a silently dead second handler.
- If a thrown `errorCode` matches no handler on that task, it does **not** silently disappear — it becomes an
  unhandled technical incident (no automatic retry, since re-running the same logic won't change a business rule's
  outcome). That's the signal that a real failure mode is undocumented in the model, not a bug to route around.

```
❌ Wrong — gateway "catching" a failure that already happened
EXECUTABLE_TASK "Validate Document" ──▶ EXCLUSIVE_GATEWAY (switches on a fabricated "validationResult" answer)
                                            ├─ expectedAnswer: "DOCUMENTO_INVALIDO" ──▶ ...
                                            ├─ expectedAnswer: "LIMITE_EXCEDIDO"    ──▶ ...
                                            └─ isDefault                            ──▶ ...

✅ Right — one boundary error handler per failure reason, no gateway
EXECUTABLE_TASK "Validate Document" (executor: validateDocumentTaskHandler)
   ├─ BOUNDARY_ERROR_HANDLER errorCode: "DOCUMENTO_INVALIDO" ──▶ "Request Resubmission"
   ├─ BOUNDARY_ERROR_HANDLER errorCode: "LIMITE_EXCEDIDO"    ──▶ "Route to Manual Review"
   └─ (task's own onComplete, the success path)              ──▶ "Continue Processing"
```

This only applies when the "switch" is driven by a task's own failure. When the branching decision comes from
data that was computed successfully (a field value, the result of a successful lookup), `EXCLUSIVE_GATEWAY`
remains the right tool — don't invert this rule the other way.

### Readable labels and output language

Every `EXCLUSIVE_GATEWAY` edge needs a short, human-readable `name` describing the decision in business terms —
not just the raw `expectedAnswer` value the engine compares against. A reader shouldn't need to know the internal
API vocabulary to understand why the flow went one way or another.

Write every generated `name`/`description`/edge label in the **language the input spec was written in** — never
default to a fixed language regardless of what the spec uses. If the spec is in Portuguese, the process reads in
Portuguese; if it's in English, it reads in English.

### Handle gaps explicitly — don't silently invent business rules

Natural-language specs are almost always incomplete somewhere. Before finalizing the model, check for
**load-bearing gaps** — ones that change what the process actually does:

- An `EXCLUSIVE_GATEWAY` where the spec describes some branches but not what happens on an unlisted answer, or
  doesn't say whether the deciding value can come back empty/unknown.
- A task the spec implies can fail (external call, human rejection) with no stated error/timeout handling.
- A decision variable, business key, or piece of data the spec references but never says where it comes from.

For these, **ask the target user a clarifying question** (or, if genuinely running as an autonomous agent step
with no one to ask, pick the most conservative default — e.g. an `isDefault` edge that routes to an explicit
"needs manual review" path rather than silently completing — and call it out prominently in the delivery
summary, Step 7). Do **not** guess a specific business outcome (e.g. inventing what happens when a compliance
check "fails") and present it as if the spec said so.

Gaps that are purely cosmetic (a node's display name, exact wording of a label) don't need this — use
reasonable, spec-consistent defaults.

---

## Step 2 — File structure

A `.kikwi` file deployed via `POST /process-definitions` is a `ProcessDefinitionDeployRequest`:

```json
{
  "key": "stable-process-identifier",
  "name": "Readable Process Name",
  "description": "What this process represents, in 1-2 sentences.",
  "sla": "",
  "defaultStartPoint": "START_NODE_ID",
  "flowNodes": { "...": "..." },
  "extensionProperties": {}
}
```

(`id`, `version`, `checksum` don't exist yet at this point — the engine fills them in on deploy, and reading
back a deployed `ProcessDefinition` will include them alongside these same fields.)

- `key`: `kebab-case`, short, stable — this is what `KikwiflowEngine.startProcess().byKey(...)` targets, and
  what a redeploy under the same value versions over (running instances stay on their original version).
- `flowNodes`: a map of `node id → node object`. **The map key and the `"id"` field inside the node object
  must be identical** — the engine resolves references by the map key, not by the inner `id`, and nothing in
  the parser reconciles a mismatch for you.
- `defaultStartPoint`: the `id` of the `DEFAULT_START_EVENT` node.

Every node carries these common fields (from `FlowNodeDefinition`):

```json
{
  "id": "SAME_VALUE_AS_THE_MAP_KEY",
  "name": "Short, readable name",
  "type": "NODE_TYPE",
  "description": "What this step does, in business language — tie it back to the spec sentence it came from.",
  "commitBefore": false,
  "commitAfter": false,
  "outgoing": [ /* see below */ ],
  "extensionProperties": {},
  "layout": { "x": 0.0, "y": 0.0 }
}
```

`commitBefore: true` means: the engine persists state **before** running this node and execution from that
point on becomes asynchronous (a background worker, not the same call that triggered the previous step) —
picked up automatically for `EXTERNAL_TASK`/waits, and worth setting explicitly on an `EXECUTABLE_TASK` that
does slow/failure-prone I/O (an external HTTP call, a write with retry semantics) so it survives an app
restart mid-flight. Leave `false` on fast in-memory logic.

Only some node types additionally carry `boundaryEventIds` (a `List<String>`) — `EXECUTABLE_TASK`,
`EXTERNAL_TASK`, `EVENT_CATCHER`, `TIMER_TASK`, `CALL_ACTIVITY_COORDINATOR`. The rest (gateways, events,
boundary nodes themselves) don't have the field at all.

### `outgoing` — the exact `SequenceFlowDefinition` shape

**This is the field set the engine actually deserializes — use exactly this, nothing more:**

```json
{
  "id": "flow-<uuid-or-descriptive-slug>",
  "name": "",
  "description": "",
  "targetNodeId": "NEXT_NODE_ID",
  "isDefault": false,
  "handlesNull": false,
  "expectedAnswer": null
}
```

There is **no `transitionType` field and no `extensionProperties` field on a sequence flow** — those exist on
`FlowNodeDefinition` (the node), not on `SequenceFlowDefinition` (the edge); including them is harmless if the
target project's Jackson config ignores unknown properties, but don't rely on that, and don't invent them from
memory. `isDefault`/`handlesNull` are plain `boolean` (default `false` if omitted); `expectedAnswer` only means
anything on an `EXCLUSIVE_GATEWAY`'s edges (see [`reference/node-types.md`](reference/node-types.md)). A
`positionHandlers` field (waypoints for the connector line's visual bend points) exists too — purely cosmetic,
safe to omit. Every node type other than `EXCLUSIVE_GATEWAY`/`PARALLEL_GATEWAY` should declare **at most one**
entry in `outgoing`.

(Note: a companion documentation-only spec — used by [`document-java-as-kikwi`](../document-java-as-kikwi/SKILL.md) —
does include `transitionType` and per-edge `extensionProperties`. That's a deliberate divergence, not an
oversight: this skill's output must actually deploy, so it follows the deserialization records/`DeployValidator`
cited below over a prose spec. If the target project's real generated model classes are available, verify against
those directly instead of taking either doc's word for it.)

(Note: Kikwiflow Craft itself now formalizes part of that documentation-only divergence: it always writes
`extensionProperties` on every edge (default `{}`), and recognizes two reserved keys —
`kikwi:documentation` (embedded markdown, may include Mermaid diagrams and code blocks) and
`kikwi:documentationLink` (a local path or web URL) — as the sanctioned way to attach rich documentation to
a node, an edge, or the process itself, editable via each panel's "Documentação" section. These two keys are
purely descriptive; they carry the same deploy-safety caveat as any other edge `extensionProperties` above —
don't assume a real deploy target reads or tolerates them.)

---

## Step 3 — Node type catalog and required fields

Load [`reference/node-types.md`](reference/node-types.md) for the full 15-type catalog (required fields per
type), the shared correlation-field shape (`EVENT_CATCHER`/`EVENT_THROWER`/`BOUNDARY_INTERRUPTIVE_CATCH_EVENT`),
the boundary-event attachment allowlist, `EXCLUSIVE_GATEWAY` routing priority, and the `retryPolicy`/
`schedulePolicy` shapes. Field names there are transcribed from the actual `record`s in `kikwi-model`, not
prose docs, which can drift — consult it per node type as you build the graph rather than trying to hold the
whole catalog in mind at once.

---

## Step 4 — Resolving `executor`/`providerBean` against real beans

This is what makes the output deployable instead of decorative. If you're running inside (or pointed at) the
target Spring Boot project:

1. Search for existing beans that already do what a step needs — `@Component("name") implements TaskHandler`
   for `EXECUTABLE_TASK.executor`, `implements AnswerProvider` for `EXCLUSIVE_GATEWAY.providerBean` (when
   `providerType: BEAN`), `implements DueDateProvider` for timer `providerBean`, `implements
   CorrelationKeysProvider` for a correlation `providerBean`. Reuse the exact registered name when a match
   exists — don't invent a new name for logic that already exists.
2. For steps with no matching bean, choose a name following the project's existing bean-naming convention
   (usually `camelCase`, often prefixed/suffixed consistently — check a couple of existing examples first) and
   record it as a **component to implement** (see Step 7) — do not silently leave a dangling reference and call
   the file done.
3. If there's no target project to check against (pure modeling exercise, greenfield), use descriptive
   `camelCase` names derived from the step's business meaning, and say explicitly in the delivery summary that
   none of them have been verified against real beans yet.

`EXTERNAL_TASK` never takes an `executor` — there's nothing to resolve there; the "who does it" is whatever
worker/human process claims and completes it via the engine's task API, not a bean reference in the definition.

**Important nuance for `EXECUTABLE_TASK`:** `DeployValidator` only checks bean resolution *if* `executor` is
present — an `EXECUTABLE_TASK` with a blank/missing `executor` deploys successfully today and only fails later,
at runtime, when the engine tries to execute it with nothing to call. Always fill it in; don't treat "the
deploy succeeded" as proof the model is correct.

---

## Step 5 — Layout: hand off to `beautify-kikwi-diagram`

Computing final `x`/`y` coordinates is a deliberately separate concern from everything above — see
[`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md) for why, and for the actual node-sizing/spacing/
arrangement rules. At this stage:

- Leave every node's `layout` at `{ "x": 0, "y": 0 }` (or omit the field entirely). Don't try to compute pixel
  positions while you're still focused on getting node types, attachments, and routing right — mixing the two
  concerns in one pass is exactly what produces both a subtly-wrong graph *and* a messy diagram.
- Once the graph passes the Step 6 checklist below, run `beautify-kikwi-diagram` over the result as its own
  pass before treating the file as done for a human reader.
- If you're producing the file in a context where a second pass genuinely isn't possible, apply
  `beautify-kikwi-diagram`'s rules directly yourself as a final, separate step — but still do it *after*
  Step 6, never interleaved with building the graph.

---

## Step 6 — Validity checklist

Load [`reference/validation-checklist.md`](reference/validation-checklist.md) before delivering. It's split
into two deliberately separate tiers: **A**, what `kikwi-core`'s `DeployValidator` actually checks today (get
any of these wrong and `POST /process-definitions` throws `InvalidProcessDefinitionException`, or for some
gateway/deploy-flag cases a raw `500`); and **B**, *not* checked at deploy time in the current engine version —
a definition violating these deploys successfully and then breaks, stalls, or silently misbehaves at runtime.
Model to satisfy both; only tier A is what "the deploy will actually reject" means, so don't treat a clean
deploy as proof the model is fully correct.

---

## Step 7 — What to deliver

1. The `<process-key>.kikwi` file.
2. **Components to implement** — a short list of any `executor`/`providerBean`/`providerVariable` values that
   don't yet correspond to real code, each with: the bean name used, the interface it needs to implement
   (`TaskHandler`/`AnswerProvider`/`DueDateProvider`/`CorrelationKeysProvider`), and which node(s) reference it.
   Empty list is fine and worth stating explicitly ("everything resolved against existing beans").
3. **Assumptions and open questions** — every load-bearing gap from Step 1 that you resolved with a
   conservative default instead of getting confirmation, and anything you *did* ask about but is still
   unresolved. Be explicit that these are guesses, not requirements extracted from the spec.
4. If anything in the model relies on a **tier-B** item from Step 6 (unenforced at deploy), call it out — it's
   the kind of thing that passes a smoke-test deploy and then breaks the first time a real instance exercises
   that path.
5. A one-paragraph summary: node count, types used, and any simplification made versus the literal spec text.
6. Confirm whether `beautify-kikwi-diagram` was run as a follow-up pass. If not, say so explicitly — a file
   with every `layout` left at `{ "x": 0, "y": 0 }` is structurally valid but not yet ready for a human reader.

---

## Reference example

[`examples/expense-approval.kikwi.json`](examples/expense-approval.kikwi.json) is a complete, valid file for a
"request needs review, with an SLA that escalates it" shape — an `EXTERNAL_TASK` awaiting manager approval,
with a `BOUNDARY_INTERRUPTIVE_TIMER` that escalates to finance review after 48h with no response. Use it as a
formatting template, not content to copy; the actual flow, names, and traceability always come from the real
spec. Every `layout` in it is zeroed, per Step 5 — it would still need a `beautify-kikwi-diagram` pass before
being handed to a human reader (see the [repo tutorial](../../TUTORIAL.md) for that pass applied to this exact
file). The example also illustrates the Step 1 "handle gaps explicitly" rule in practice: the source spec
fragment it was built from never says what happens if the manager explicitly *rejects* the expense (only "no
response" is handled, via the timer) — that gap is the kind of load-bearing ambiguity to surface in Step 7
rather than silently omit or silently invent a rejection path.

## Where the ground truth lives

This file's field names and the [validation checklist](reference/validation-checklist.md)'s tier-A rules were
transcribed directly from `kikwi-model`'s `record`s (`io.kikwiflow.model.definition.process.elements.*`) and
`kikwi-core`'s `io.kikwiflow.validation.DeployValidator`, not from prose documentation — the engine's own docs
under `docs/` are known to drift ahead of what's actually implemented. If the Kikwiflow engine repository is
available for cross-checking (it usually won't be, from inside a downstream project), those two source
locations are the authoritative tie-breaker over anything written here, including this file.
