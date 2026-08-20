---
name: beautify-kikwi-diagram
description: >
  Takes a structurally-valid Kikwiflow `.kikwi` file — produced by `model-kikwi-process` or
  `document-java-as-kikwi`, or any other already-correct process definition — and computes
  human-readable `layout` coordinates for every node, so the diagram opens without overlapping
  cards, unnecessary edge crossings, or unreadable gateway fan-out. This is a separate pass from
  building the graph: it never adds, removes, renames, or retypes a node or edge, and never
  changes any business/schema field (`executor`, `providerBean`, `errorCode`, routing fields,
  etc.) — only `layout.x`/`layout.y` (and, where it genuinely helps, cosmetic
  `positionHandlers`). Trigger this skill when asked to "lay out", "organize", "beautify",
  "reflow", "reposition", or "fix the layout of" a `.kikwi` file, or as the follow-up step after
  generating one with a sibling modeling skill.
---

# Skill: Beautify a Kikwiflow diagram's layout

> See also: [`model-kikwi-process`](../model-kikwi-process/SKILL.md) and
> [`document-java-as-kikwi`](../document-java-as-kikwi/SKILL.md) — the two skills that build the graph
> this skill lays out. Run this one *after* either of them, as its own pass — not folded into the
> same turn as building the graph.

## Why this is a separate skill

Building a structurally-correct process graph (right node types, right boundary-event attachment,
valid gateway routing) and laying that graph out for human readability (non-overlapping
coordinates, minimal edge crossings, a sensible branch/row arrangement) are two different kinds of
reasoning — one is schema/rules-following, the other is spatial. Asking for both in the same pass
means pixel arithmetic competes for attention with "did I attach this boundary event to the right
host type", and that split focus is exactly the kind of thing that produces mistakes in *either*
concern. Splitting them means:

- The construction skill can leave every node's `layout` at `{ "x": 0, "y": 0 }` (or omit the
  field) and focus entirely on getting the graph right.
- This skill can assume the graph is already correct and focus entirely on where to put things —
  it never needs to reason about `errorCode`s, `providerType`s, or routing rules.
- There is deliberately no mechanical auto-layout tool in this loop. This skill's job is to do, by
  hand, the same kind of spatial reasoning a careful human modeler would — auto-layout engines
  degrade badly on non-trivial graphs, so the coordinates below come from actually reasoning about
  the graph's shape, not from delegating to a tool.

## Strict contract: layout only

Given a `.kikwi` file (or an equivalent in-memory graph), this skill:

- **May only change** each node's `layout.x`/`layout.y`, and, if it meaningfully improves an
  edge's visual clarity, an edge's cosmetic `positionHandlers` (waypoints).
- **Must not** add, remove, rename, or retype any node or edge, and must not change any
  business/schema field — `executor`, `providerBean`, `providerVariable`, `errorCode`,
  `expectedAnswer`, `isDefault`, `handlesNull`, `attachedToRef`, `boundaryEventIds`,
  `extensionProperties`, retry/schedule policies, none of it.
- If the graph's shape makes a genuinely clean layout impossible without restructuring the graph
  itself (see Step 5), **report that back** instead of quietly restructuring it — that decision
  belongs to whoever built the graph, not to this pass.

## Step 1 — Read the graph before placing anything

Parse `flowNodes`: build the adjacency (source → target via each node's `outgoing`, plus
`targetJoinId` linking a `PARALLEL_GATEWAY` to its `JOIN_GATEWAY`), and separately collect each
node's `boundaryEventIds` — those don't occupy their own position (Step 2 explains why). From the
adjacency, identify:

- **The main path** — the longest/most central chain from `defaultStartPoint` to an end event,
  usually the one most branches split off from and eventually rejoin.
- **Branch points** — every `EXCLUSIVE_GATEWAY`/`PARALLEL_GATEWAY`, how many outgoing paths each
  has, and where each path rejoins (if it does).
- **Convergence points** — any node reached by edges from more than one distant gateway/branch.

## Step 2 — Real node sizes (the basis for every distance calculation)

The official Kikwiflow visual editor renders every node type at a real, predictable size — these
values come straight from each component's CSS, not a guess:

| Node family | Types | Width | Base height | What increases height |
|---|---|---|---|---|
| Event (circle) | `DEFAULT_START_EVENT`, `DEFAULT_END_EVENT` | ~140px | ~70px | Nothing — fixed |
| Gateway (diamond) | `EXCLUSIVE_GATEWAY`, `PARALLEL_GATEWAY`, `JOIN_GATEWAY` | ~140px | ~80px | Nothing — fixed |
| Task (rectangle) | `EXECUTABLE_TASK`, `EXTERNAL_TASK`, `TIMER_TASK`, `EVENT_CATCHER`, `CALL_ACTIVITY_COORDINATOR` | **300px, always** | `EXECUTABLE_TASK`: ~150px (retry footer always renders). Others: ~120px | Each boundary event listed inside the card adds **+~35px**. An interruptive timer (SLA) adds **+~30px**, except on `EXECUTABLE_TASK` (already counted). `EVENT_CATCHER` with `catchType: GROUP` or `CALL_ACTIVITY_COORDINATOR` with `collectionVariable` add **+~28px** (progress bar). |

**Boundary events don't get their own box.** The editor draws them *inside* the parent card as a
row/badge — never reserve separate `x`/`y` space for a `BOUNDARY_*` node; its only layout effect is
growing its parent's height (table above), which pushes down whatever sits below it in the same
column. `EVENT_THROWER` has no dedicated editor component yet — treat it as a 300px/~120px
task-family node for sizing purposes only (this is purely a layout stand-in; it doesn't change
what `EVENT_THROWER` can do structurally — see the construction skills for that).

## Step 3 — Spacing rules

- **Two task-family nodes in sequence:** increment `x` by **at least 480–500px** (300px card +
  180–200px margin so the connecting line isn't crammed).
- **Compact (event/gateway) → task, either order:** **at least 300–350px** is enough.
- **Two compact nodes in sequence:** **~250px** is safe.
- **Parallel/alternative branches (different rows):** separate `y` by **at least 220–260px** when
  task cards are involved (120–140px if the row is only compact nodes) — use the tallest node in a
  row (base height + any boundary-event/progress-bar increments from Step 2) to decide how far
  below it the next row needs to start.

## Step 4 — Arranging the graph for readability

Spacing alone prevents overlap; arrangement is what makes the diagram actually easy to follow:

- Lay the main path (Step 1) out as a single horizontal line at a fixed `y`.
- Give each branch opened by a gateway its own row (`y`) above or below that line. Reconverge a
  branch onto the main line (or onto a shared end event) once it concludes — don't let it wander
  back across the main row and collide with it.
- Order sibling branches left-to-right by where they eventually end up (their target column), so
  connecting edges don't have to cross each other to reach a node placed "out of order" relative
  to its neighbors.
- For a `PARALLEL_GATEWAY`/`JOIN_GATEWAY` pair, treat every branch between them the same way as
  gateway branches above — one row per parallel branch, all reconverging at the `JOIN_GATEWAY`'s
  column.

## Step 5 — When layout alone can't fix it

If, after Steps 2–4, a gateway still needs more rows than a reader can reasonably scan, or a node
is absorbing edges from an unreasonable number of distant branches, don't force a technically
non-overlapping but still-unreadable result. Lay it out as cleanly as the current graph shape
allows, and say so explicitly in your delivery note (Step 6) — restructuring the graph itself (a
two-stage decision, or extracting a `CALL_ACTIVITY_COORDINATOR` for a repeated tail) is a modeling
change that belongs back with whichever construction skill produced the graph, not something this
pass should do unilaterally by adding/removing nodes.

## Step 6 — What to deliver

1. The same `.kikwi` file, unchanged in every field except each node's `layout` (and any
   `positionHandlers` you deliberately adjusted for edge clarity).
2. A short note listing any place you couldn't lay out cleanly without restructuring (Step 5), so
   whoever iterates on the model next knows exactly where to look.
