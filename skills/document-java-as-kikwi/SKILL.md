---
name: document-java-as-kikwi
description: >
  Reads any Java project and produces a .kikwi file (Kikwiflow process JSON) documenting the business flow
  implemented in the code — steps, decisions, external calls, error handling, waits, and parallelism — meant
  to be visualized as a diagram. Attaches rich per-node documentation (kikwi:documentation: real code/query
  excerpts, Mermaid diagrams for internal branching or multi-system sequences) rather than flat property
  dumps. Documentation-only: the generated file is never deployed or executed against a real Kikwiflow engine.
  Trigger this skill when asked to "document", "map", or "generate a diagram/.kikwi" for the flow of an
  existing Java project.
---

# Skill: Document a Java project as `.kikwi`

> See also: [`model-kikwi-process`](../model-kikwi-process/SKILL.md) — the mirror skill, for modeling a
> deployable process from a natural-language spec instead of documenting existing code — and
> [`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md), the separate follow-up pass that
> computes readable `layout` coordinates once this skill's graph is structurally done.
>
> Bundled reference material, loaded on demand as each step below points to it:
> [`reference/node-types.md`](reference/node-types.md) (full node type catalog, Step 3) and
> [`reference/validation-checklist.md`](reference/validation-checklist.md) (structural checklist, Step 5).
> A worked example lives at [`examples/process-order.kikwi.json`](examples/process-order.kikwi.json).
>
> New here? See the [repo tutorial](../../TUTORIAL.md) for a full worked prompt → output walkthrough.

## What Kikwiflow is (context needed before you start)

Kikwiflow is a process orchestration engine (workflow/BPM) built in Java, with one central difference from
traditional engines (Camunda, Activiti, jBPM): **it is not based on BPMN XML and does not use an expression
language** (no embedded SpEL/JUEL/FEEL). A Kikwiflow process is a **graph of nodes described in JSON** — the
`.kikwi` file — and the logic of each node (decision, task) is, in a real application, a plain Java class
registered as a bean and referenced by name (`executor`, `providerBean`).

In practice, a `.kikwi` file visually represents what a business flowchart would: a starting point, a sequence
of steps, decision points, waits for something external (a human, a system, a deadline), error handling, and
one or more end points — just structured as a specific JSON schema, with its own validity rules (which node
types exist, what each can/cannot do, how connections between nodes work). This schema is what this skill uses
as a **diagramming language**, not as something meant to actually run.

There is also an **official Kikwiflow visual editor** that renders these files as a canvas of connected cards
(its real node sizes are the layout reference used by the [`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md)
follow-up pass) — the `.kikwi` produced by this skill should be ready for that kind of visualization, even
though it is never deployed.

## When to use this skill

Use it when asked to **document, map, or diagram the business flow of an existing Java project** in the
Kikwiflow format — typical requests look like "document this service as `.kikwi`", "generate a diagram of this
project's order flow", "I want to visualize how this module works as a process". **Do not** use this skill to
generate processes meant to actually be deployed/executed on a real Kikwiflow engine, and do not create new
`TaskHandler`s/beans in the analyzed project — that is out of scope (see the golden rule below).

## Objective

Whenever triggered, this skill reads the given Java project and produces **a single `.kikwi` file** (JSON)
that documents, in Kikwiflow's process format, the business flow that code implements — its steps, decisions,
external calls, error handling, and waits. The input project can be any Java codebase (Spring or not, monolith
or service) — nothing below is specific to any one project.

**Golden rule: this is documentation, not deployment.** The resulting file is never going to be deployed onto
a real Kikwiflow engine. It exists so a human (or another agent) can visualize/understand the business flow by
looking at a structured graph, instead of reconstructing it by reading class after class. Because of this:

- **Do not create** `TaskHandler` classes, Spring beans, or any new code in the project.
- **Do not try** to run, compile against, or validate the file against a real Kikwiflow engine.
- The `executor`/`providerBean` values in the `.kikwi` **do not need to correspond to a Spring bean that
  actually exists** — they are descriptive names pointing back to the originating Java class/method (see
  Step 4).
- If the project doesn't use Spring, or has no "beans" in the sense Kikwiflow uses, that's fine — treat
  `executor`/`providerBean` as a free-text identifier, not a requirement that a matching bean exists.

The final file needs to be **structurally valid** (well-formed JSON, every reference between nodes resolves,
gateway rules respected — see the checklist in Step 5) even though it's never executed, because that's what
lets the file open cleanly in a Kikwiflow modeling/visualization tool.

---

## Step 1 — Read the project and identify the process

Before writing any JSON, mentally (or on a scratch pad) assemble the list of business-flow steps. Look for:

| What to look for in the code | Becomes, in the `.kikwi`... |
|---|---|
| Entry point (REST controller, queue listener, `main`, scheduled job) | The `DEFAULT_START_EVENT` node |
| A sequence of method/service calls, one after another | A chain of `EXECUTABLE_TASK` |
| `if`/`else`, `switch`, Strategy Pattern, business rule that picks a path | `EXCLUSIVE_GATEWAY` |
| Call to an external system that doesn't return right away (async queue, expected webhook, human approval, callback) | `EXTERNAL_TASK` |
| Firing a correlated event outward (publishing a message another system will react to, without waiting for a response) | `EVENT_THROWER` |
| Waiting for a message/callback identified by a business key (e.g. a payment-approved webhook) | `EVENT_CATCHER` |
| `try/catch` of a known business exception (validation failed, a rule rejected the case) — **not** a bug/infra failure | `BOUNDARY_ERROR_HANDLER` |
| Explicit timeout/SLA/deadline in the code (e.g. cancel if no response within X minutes) | `BOUNDARY_INTERRUPTIVE_TIMER` (cancels the wait) or `BOUNDARY_NON_INTERRUPTIVE_TIMER` (only notifies, doesn't cancel) |
| A deadline wait that is itself the next step of the flow (not attached to another task) — e.g. "wait 24h before the next reminder" | `TIMER_TASK` |
| Parallel execution of N independent tasks, all needing to finish before continuing | `PARALLEL_GATEWAY` (opens the branches) + `JOIN_GATEWAY` (synchronizes) |
| Call to another module/service that is itself a complete business process (or batch processing over a list of items) | `CALL_ACTIVITY_COORDINATOR` |
| `return`, end of a path, unhandled exception that terminates the flow | `DEFAULT_END_EVENT` |

Don't model at the code level (a trivial null-check `if` doesn't need to become a gateway) — model at the
**business process** level: the steps someone from the business side would recognize as "steps" if you
narrated the flow out loud.

### Business errors: `BOUNDARY_ERROR_HANDLER`, never `EXCLUSIVE_GATEWAY`

Watch for this specific misreading of the code: a task/service call wrapped in `try/catch`, followed by an
`if`/`switch` on the caught exception's type or a status field set inside the `catch` block. It's tempting to
transcribe that as a task followed by an `EXCLUSIVE_GATEWAY` switching on the failure reason. Don't —
`EXCLUSIVE_GATEWAY` documents a decision made on data that was **successfully computed**; it has no way to
represent "the previous step threw." The actual Java shape (a handler that can throw, caught and dispatched on
by type/code) maps to a `BOUNDARY_ERROR_HANDLER` attached to the task, matching on `errorCode`.

When the code catches **several distinct exception types/codes** from the same call and handles each
differently, that "switch by failure reason" is documented as **multiple `BOUNDARY_ERROR_HANDLER`s on the same
`EXECUTABLE_TASK`, one per `errorCode`, each with its own `outgoing`** — not as a gateway placed after it. A
catch-all `catch (Exception e)` fallback maps to a `BOUNDARY_ERROR_HANDLER` with `errorCode` omitted (a
wildcard); at most one of those per task.

```
❌ Wrong — gateway transcribed from a try/catch's dispatch logic
EXECUTABLE_TASK "Charge Card" ──▶ EXCLUSIVE_GATEWAY (switches on a fabricated "chargeResult")
                                     ├─ expectedAnswer: "CARD_DECLINED" ──▶ ...
                                     ├─ expectedAnswer: "TIMEOUT"       ──▶ ...
                                     └─ isDefault                      ──▶ ...

✅ Right — one boundary error handler per caught exception type, no gateway
EXECUTABLE_TASK "Charge Card" (executor: paymentServiceChargeCard, from PaymentService.chargeCard())
   ├─ BOUNDARY_ERROR_HANDLER errorCode: "CARD_DECLINED" ──▶ "Notify Customer of Decline"
   ├─ BOUNDARY_ERROR_HANDLER errorCode: "TIMEOUT"        ──▶ "Retry via Backup Gateway"
   └─ (task's own onComplete, the success path)          ──▶ "Confirm Order"
```

Only use `EXCLUSIVE_GATEWAY` for a decision the code makes on a value it already holds (an `if`/`switch`/
Strategy Pattern over successfully-obtained data) — that part of the original mapping table doesn't change.

### Readable labels and output language

Give every `EXCLUSIVE_GATEWAY` edge a short, human-readable `name` describing the decision in business terms,
not just the raw `expectedAnswer` string — a reader shouldn't have to know the code's internal vocabulary to
follow the diagram. As already noted in Step 6: write every generated `name`/`description`/edge label in the
language natural to the analyzed project's business domain — this applies to gateway edge labels just as much
as node names.

---

## Step 2 — File structure

A `.kikwi` file is a single JSON object with these top-level fields:

```json
{
  "key": "stable-process-identifier",
  "name": "Readable Process Name",
  "description": "What this process represents, in 1-2 sentences.",
  "extensionProperties": {},
  "sla": "",
  "flowNodes": { "...": "..." },
  "defaultStartPoint": "START_NODE_ID"
}
```

- `key`: `kebab-case`, short, stable (e.g. `order-processing`).
- `flowNodes`: a map of `node id → node object`. **The map key and the `"id"` field inside the node object
  must be identical.** This isn't just style — the real engine uses the map key to resolve references and the
  internal `id` field for other things; a mismatch between the two is a whole class of silent bug (even with
  the file never being executed, keep them equal so the file serves as a correct reference).
- `defaultStartPoint`: the `id` of the `DEFAULT_START_EVENT` node. Required.

Every node, regardless of type, carries these common fields:

```json
{
  "id": "SAME_VALUE_AS_THE_MAP_KEY",
  "name": "Short, readable name",
  "description": "What this step does, in business language.",
  "type": "NODE_TYPE",
  "commitBefore": false,
  "commitAfter": false,
  "outgoing": [ /* list of connections, see below */ ],
  "layout": { "x": 0, "y": 0 },
  "extensionProperties": {}
}
```

- `commitBefore`/`commitAfter`: for documentation purposes, use these as semantic flags — `true` on an
  `EXECUTABLE_TASK` suggests "this is an operation that can take time/fail/does external I/O" (reflect what
  the real code does, e.g. an HTTP call gets `commitBefore: true`; an in-memory data transformation stays
  `false`). It has no effect since nothing is actually executed, but it documents intent.
- `layout`: coordinates for visualization (`{ "x": number, "y": number }`, top-left of the node). Every node
  carries this field, including boundary events — but leave it at `{ "x": 0, "y": 0 }` for now. Computing real
  positions is a separate concern, handled by [`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md) as a
  follow-up pass once the graph below is structurally complete (Step 5's checklist); see that skill for node
  sizing, spacing, and arrangement. Don't reason about pixel positions while you're still extracting the graph
  from the code — that split focus is exactly what produces both a wrong graph and a messy diagram.

### Rich per-node documentation: `kikwi:documentation` / `kikwi:documentationLink`

Beyond the plain `description` field above (kept short — one to three sentences), the Kikwiflow modeler
recognizes two reserved `extensionProperties` keys — on **every** node, every edge, and the process root —
for richer documentation, each with a maximize button and its own fullscreen preview in the editor:

- **`kikwi:documentation`** — embedded Markdown. Supports fenced code blocks (rendered with syntax
  highlighting for whatever language you fence — `java`, `sql`, `json`, ...) and fenced ` ```mermaid `
  blocks, rendered as an actual diagram. This is the primary mechanism this skill should use to attach
  real explanatory depth to a node — see Step 4.
- **`kikwi:documentationLink`** — a link instead of embedded text: a web URL, or a path local to the
  project (resolvable only when the file is opened in the Kikwiflow Craft VS Code extension). Use this
  sparingly, only to point at documentation that already exists separately (an ADR, a wiki page) — never
  as a substitute for writing the excerpt described in Step 4.

The two are mutually exclusive **in the modeler's own editing UI** (a toggle switches between them and
clears whichever isn't active) — so pick one per node/edge/process. Default to `kikwi:documentation`: a
`.kikwi` file documenting real code almost always has real content worth embedding directly, rather than
a pointer elsewhere.

:::info `EVENT_THROWER` has no fire-and-forget mode
It also has no `boundaryEventIds` field at all: if the code implies best-effort emission ("notify if anyone's
listening"), flag that as a modeling gap in Step 6 rather than attaching a boundary event that isn't supported.
(Separately, `EVENT_THROWER` also has no dedicated card in the visual editor yet — `beautify-kikwi-diagram`
covers how to size it for layout purposes; that's a rendering detail, not a modeling one.)
:::

Each outgoing connection (`outgoing`) is:

```json
{
  "id": "flow-<uuid-or-descriptive-slug>",
  "name": "",
  "targetNodeId": "NEXT_NODE_ID",
  "transitionType": "automated",
  "isDefault": false,
  "expectedAnswer": null,
  "handlesNull": false,
  "extensionProperties": {}
}
```

- `targetNodeId` **must** exist as a key in `flowNodes`.
- `expectedAnswer`/`isDefault`/`handlesNull` only have an effect when the source node is `EXCLUSIVE_GATEWAY`
  (see [`reference/node-types.md`](reference/node-types.md)). For any other node type, leave `isDefault: false`,
  no `expectedAnswer`/`handlesNull`, and declare **at most one** entry in `outgoing` (regular nodes only have
  one logical exit).

(Note: the companion deploy-grade skill, [`model-kikwi-process`](../model-kikwi-process/SKILL.md), explicitly omits `transitionType` and
per-edge `extensionProperties` from this shape, citing the engine's real deserialization records as ground
truth. This skill keeps both fields — that's deliberate, not an inconsistency to fix: this output is never
deployed, so there's no risk in keeping fields a documentation-oriented spec includes for descriptive value.)

---

## Step 3 — Complete node type catalog

Load [`reference/node-types.md`](reference/node-types.md) for the full 15-type catalog and the boundary-event
attachment allowlist (which parent node types accept which boundary node types) and the `EXCLUSIVE_GATEWAY`
routing priority order. Consult it per node type as you build the graph — don't invent new type values beyond
the 15 it lists.

---

## Step 4 — Traceability: linking each node back to the real source code

This is the part that gives the file its documentation value — and the part most worth getting right, since
a reader (a QA engineer trying to understand a flow they didn't build, a new hire) leans on it to actually
understand what a node does without opening the IDE. For **every node** that represents a real step of code
(`EXECUTABLE_TASK`, `EXCLUSIVE_GATEWAY`, `EXTERNAL_TASK`, etc.), give it **both**:

1. **Structured, machine-readable origin**, in `extensionProperties` — small, flat, easy to grep/query across
   the whole file, unchanged in shape from before:

```json
"extensionProperties": {
  "source.class": "com.company.orders.OrderService",
  "source.method": "processOrder(Order order)",
  "source.file": "src/main/java/com/company/orders/OrderService.java:42",
  "kikwi:documentation": "## What this does\n\n..."
}
```

2. **A human-readable write-up**, in `kikwi:documentation` (see above) — Markdown, as long as it needs to be
   to actually explain the step, written like you're explaining it to someone who can read code but hasn't
   opened this file before:
   - What the step does and why, in a sentence or two (can restate/expand `description`).
   - **The actual relevant code excerpt**, fenced with its real language (` ```java `, ` ```sql ` for a
     repository `@Query`, etc.) — not the whole method if it's long, just the part that carries the business
     rule: the query, the condition, the calculation. This is the single highest-value thing this skill can
     capture — a reader should see *the real query/condition*, not just a name pointing at it.
   - When the step's own internal logic has real branching or several sub-calls that don't deserve promotion
     to their own Kikwiflow nodes (see the granularity note below), a fenced ` ```mermaid ` diagram of that
     internal logic.

Field-specific guidance (same targets as before, richer content now):

- `EXECUTABLE_TASK`: `executor` stays a descriptive name derived from the real method (e.g. a
  `calculateShipping` method on a `ShippingService` class → `"executor": "shippingServiceCalculateShipping"`
  — **do not claim that name corresponds to a registered Spring bean**, it's just a readable label);
  `kikwi:documentation` carries the method's actual logic/query.
- `EXCLUSIVE_GATEWAY`: `providerBean`/`providerVariable` point at the real condition (the field/method the
  business logic tests); `description` states the decision rule in one plain sentence; `kikwi:documentation`
  is for the *full* rule when it's more than that one sentence (nested conditions, a lookup table, a Strategy
  Pattern with several implementations) — a small Mermaid flowchart of the internal branching is often the
  clearest way to document this.
- `EXTERNAL_TASK` / `EVENT_CATCHER` / `EVENT_THROWER`: point `extensionProperties["source.integration"]` at
  the real integration (queue, endpoint, topic) instead of a class; use `kikwi:documentation` for the payload
  shape/contract if it's non-obvious, or a short Mermaid `sequenceDiagram` if more than one system is involved
  in the round trip.
- If a node doesn't map to a specific piece of code (e.g. a `DEFAULT_START_EVENT` representing "the HTTP
  request arrives"), a short `description` is enough — don't force a `kikwi:documentation` write-up that has
  nothing real to say.

A non-trivial `EXCLUSIVE_GATEWAY` edge (a routing rule that needs more than its `name` to explain — a
multi-field condition, a business exception to the general rule) can carry its own `kikwi:documentation` too;
edges support the same reserved key, in the same `extensionProperties` map shown in Step 2.

### Granularity: model the graph at business-process level, push internal detail into `kikwi:documentation`

Step 1 already says not to model at the code level (a trivial null-check doesn't need its own gateway). That
judgment now has a release valve instead of being a hard cutoff: when a real step's internal logic *is* worth
visualizing, but promoting every branch to its own Kikwiflow node would fragment the top-level diagram past
readability (a helper method with three nested conditions, a multi-service call sequence that's really one
conceptual "charge the customer" step), keep it as **one** node in the main graph and embed a Mermaid diagram
of the internal detail in that node's `kikwi:documentation` instead. The main graph stays a clean
business-process narrative; the depth is one click away (the modeler's fullscreen preview) for whoever needs
it. This is the main judgment call this skill should make when deciding *how much* of the code's real
branching earns a full node versus a diagram inside one.

Use `kikwi:documentationLink` instead of embedding only when there's a genuinely separate, already-existing
document to point to (an ADR, a runbook, a wiki page) — not as a shortcut in place of the write-up above.
Don't set both `kikwi:documentation` and `kikwi:documentationLink` on the same node/edge/process (see the
note above — the modeler only shows one at a time).

---

## Step 5 — Structural validity checklist before delivering

Load [`reference/validation-checklist.md`](reference/validation-checklist.md) and check every item before
considering the file done — a `.kikwi` that violates any of these is structurally invalid, even though it's
never executed.

---

## Step 6 — What to deliver

1. A `<process-name>.kikwi` file, valid JSON, following everything above.
2. A short paragraph (outside the JSON, in the chat/PR/wherever it's delivered) summarizing: how many nodes,
   which types were used, and any simplification you made (e.g. "3 trivial null-checks in the code were
   merged into a single `EXECUTABLE_TASK` 'Validate Order' to avoid cluttering the diagram").
3. If some part of the real flow has no obvious matching node type in the [reference catalog](reference/node-types.md),
   **don't force a wrong fit** — describe the gap in the summary paragraph instead of modeling something
   misleading.

Note: node `name`/`description` content — and the prose inside every `kikwi:documentation` write-up — in the
generated `.kikwi` should reflect whatever language is natural for the analyzed project's business domain
(e.g. Portuguese node names and documentation for a Brazilian codebase whose domain vocabulary is in
Portuguese) — this skill's own instructions are in English, but the output should read naturally to that
project's team, not be force-translated. Code excerpts and Mermaid diagram node labels can stay as they are
in the source (don't translate identifiers/query text), but any surrounding prose you write should match.

Confirm whether `beautify-kikwi-diagram` was run as a follow-up pass. If not, say so explicitly — a file with
every `layout` left at `{ "x": 0, "y": 0 }` is structurally valid but not yet ready for a human reader.

---

## Reference example

[`examples/process-order.kikwi.json`](examples/process-order.kikwi.json) is a complete, valid file for a
fictional "Process Order" flow: validates the order, decides between upfront or installment payment, calls an
external payment gateway (asynchronous), cancels the wait if the gateway sends a decline webhook
(`BOUNDARY_INTERRUPTIVE_CATCH_EVENT` — **not** `BOUNDARY_ERROR_HANDLER`, which is only valid on
`EXECUTABLE_TASK`, see [`reference/node-types.md`](reference/node-types.md)), and finishes. Every `layout` in
it is zeroed, per Step 2 — it would still need a `beautify-kikwi-diagram` pass before being handed to a human
reader (see the [repo tutorial](../../TUTORIAL.md) for a worked walkthrough).

Use it as a formatting template — not as content to copy. The flow, node names, and traceability must always
come from actually reading the given Java project, not from these fixed values. The `kikwi:documentation`
values on `VALIDATE_ORDER` (a real code excerpt) and `CHARGE_PAYMENT_GATEWAY` (a Mermaid sequence diagram for a
multi-system round trip) illustrate the two most common shapes from Step 4 — most other nodes in a real
output should carry one or the other.
