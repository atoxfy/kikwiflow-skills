---
name: beautify-kikwi-diagram
description: >
  Takes a structurally-valid Kikwiflow `.kikwi` file — produced by `model-kikwi-process` or
  `document-java-as-kikwi`, or any other already-correct process definition — and lays it out for a
  human reader on the real Kikwiflow canvas: nodes on a grid you decide (main path on one line, branches
  above/below), every edge routed orthogonally around cards and names, gateway branch labels where they're
  unambiguous, and the result checked by simulating how the canvas draws it. Never adds, removes, renames
  or retypes a node or edge and never changes a business field — only cosmetic fields (`layout`,
  `positionHandlers`, `labelPosition`, a gateway edge's `sourceHandle`, and the order of `boundaryEventIds`).
  Trigger this skill when asked to "lay out", "organize", "beautify", "reflow", "reposition", "make
  readable" or "fix the layout of" a `.kikwi` file, or as the follow-up step after generating one with a
  sibling modeling skill.
---

# Skill: Lay out a Kikwiflow diagram for humans

> See also: [`model-kikwi-process`](../model-kikwi-process/SKILL.md) and
> [`document-java-as-kikwi`](../document-java-as-kikwi/SKILL.md) — the two skills that build the graph
> this skill lays out. Run this one *after* either of them, as its own pass.

## What this skill learned the hard way

An earlier version of this skill asked for coordinates computed "by reasoning", from approximate node
sizes, with no tool in the loop. On a real 58-node process that produced exactly what a reader hates:
edges cutting through cards, branch labels stacked on top of each other and of other nodes, back-edges
crossing the whole diagram. A generic auto-layout (ELK layered, the same engine as the editor's
"Organizar diagrama") fixed the overlaps but produced long corridors that were no easier to read. What
worked is a split:

- **You decide the arrangement** — which path is the main line, which branches go above or below, where
  each end sits. That's the judgment a careful modeler applies, and no layout engine knows what matters to
  the reader.
- **A script does the geometry** — [`scripts/kikwi-layout.mjs`](scripts/kikwi-layout.mjs) turns your grid
  into pixels with the canvas's *measured* sizes and handle positions, routes edges with an orthogonal A*
  that avoids cards, names and crossings, places gateway labels, and **checks** the result by simulating
  the canvas's own edge drawing. You iterate on the grid until the check is clean and a rendered picture
  reads well.

And one lesson that isn't about layout at all: **when a diagram can't be made readable, the model is
usually repeating itself** (Step 1). Say so instead of polishing it.

## Strict contract: cosmetic fields only

Given a `.kikwi` file, this skill:

- **May change** only: each node's `layout.x`/`layout.y`; each edge's `positionHandlers` (waypoints),
  `labelPosition` (where a gateway branch's label sits) and, for edges leaving an `EXCLUSIVE_GATEWAY`,
  `sourceHandle` (which tip of the diamond it leaves from: `right`, `right-2` above, `right-3` below); and
  the **order** of a node's `boundaryEventIds` (it only decides the order of the rows inside the card — the
  engine doesn't care). All of these are part of the engine's wire format (`SequenceFlowDefinition` has
  `positionHandlers`, `labelPosition`, `sourceHandle`) and survive deploy and re-import.
- **Must not** add, remove, rename or retype any node or edge, or touch any business field — `executor`,
  `providerBean`, `providerVariable`, `errorCode`, `expectedAnswer`, `isDefault`, `handlesNull`,
  `attachedToRef`, the *set* of `boundaryEventIds`, `extensionProperties`, retry/schedule policies.
- If the graph's shape makes a readable layout impossible, **report it** (Step 1 / Step 5) — restructuring
  belongs to whoever built the graph.

## Step 1 — Read the graph, and decide whether it *can* be readable

Build the adjacency (`outgoing`, plus each boundary event's own `outgoing`, which leaves from its host
card) and identify:

- **The main path** — the chain from `defaultStartPoint` that the business would narrate first ("the lead
  is reminded, shows up, buys"). It becomes one horizontal line.
- **Branch points** — each gateway, how many exits, and where each exit ends up.
- **Interrupt handlers** — boundary events and where they lead; these usually live below the main line.
- **Back-edges** — edges into an earlier node (loops). Each one is a line that must travel against the
  reading direction.

Then look for the shape that no layout can save: **the same set of interrupts repeated on several waits**
(e.g. three timers that each carry "lead wrote", "status changed", "date changed", all pointing back to the
same three nodes). That is N×3 long back-edges. The readable model is a **loop with a single wait**: a
planning step decides the next step and when, one wait carries the interrupts once, a gateway runs the
step, and every step returns to planning. In a real case that took the process from 65 edges to 49 and
from unreadable to readable — with the same behavior. Recommend it to the model's owner before laying out
(it is a modeling change, not this skill's to make).

## Step 2 — The canvas's real geometry

Measured in the official editor (React Flow + the `flow-nodes` package) at zoom 1. `x`/`y` in `layout` is
the node's **top-left** corner. Full table and the edge-drawing rules:
[`reference/canvas-geometry.md`](reference/canvas-geometry.md). The essentials:

| Node | Size | Handles |
|---|---|---|
| Start / end event | **40 × 40** circle; its name is drawn **below** it (from y+52, wrapped at ~84px, up to 140px wide, 1–3 lines) | out at (46, 20); in at (−2, 20) |
| Gateway | **56 × 56** diamond; name **below** (from y+56) | in at (−2, 28); out `right` (56, 28), `right-2` (49, 21), `right-3` (49, 35) |
| Task card (any `*_TASK`, catcher, call activity) | **300** wide; height **104** + 11 + **42 per boundary row** (if any) + **32** footer (interruptive timer or retry policy); call activity +44 | in at (−2, 32); out at (302, 32); boundary row *i* at (302, 129 + 42·i); timer footer at (302, h − 18) |

How an edge is drawn: from the source handle, through each `positionHandlers` point, into the target's
**left** handle, as react-flow "smoothstep" segments between consecutive points. Orthogonal waypoints
therefore give straight lines with rounded corners; without waypoints, the canvas invents its own bends.
A gateway branch's label (a chip: its `name` plus a badge for `expectedAnswer`/default/null, ~44px tall)
sits at `labelPosition`, or, if absent, at the middle of the longest horizontal stretch — which is where
labels pile up on top of each other.

Two consequences that drive everything below:
- **Align rows by the port line, not by the top.** Cards in a row must have their input handles at the
  same `y` (`y = rowLine − 32` for a card, `− 20` for an event, `− 28` for a gateway), or every straight
  connection gets a jog.
- **Names below events and gateways are obstacles.** A line that leaves a gateway downward from its bottom
  tip runs straight through its name; the script only uses the right-side tips.

## Step 3 — Arrange the grid (this is the part that needs judgment)

Write a grid file: each visible node (boundary events are rows inside their host, not nodes) gets
`[column, row]`, row 0 being the main line, negative rows above, positive below. Optional third and
fourth values nudge a node by pixels (`[3, 1, 0, 40]`).

```json
{
  "gapX": 150, "gapY": 130,
  "colGap": { "5": 380 },
  "boundaryOrder": { "WAIT": ["CHANGED_DATE", "CHANGED_STATUS", "WROTE", "NO_SHOW"] },
  "nodes": { "START": [0, 0], "PLAN": [1, 0], "WAIT": [2, 0], "NEXT": [3, 0], "REMIND": [4, -1] }
}
```

`gapX`/`gapY` are the default gaps between columns/rows; `colGap`/`rowGap` override the gap *after* a
given column/row. Column widths and row heights come from the nodes in them, so a tall card pushes the
next row down by itself.

Rules that made the difference on real processes:

1. **Main path on row 0**, left to right, nothing else on that row between its nodes.
2. **Short excursions above, interrupt handling below.** Steps a gateway sends off and that come back
   (reminders, retries) go above; what boundary events trigger (agent replies, human tasks, no-show
   handling) goes below, near the card that triggers it.
3. **Ends next to whoever reaches them.** An end event reached from one gateway goes in the column right
   after it, above or below; an end reached from two places goes between them. Don't park all ends in a
   last column — that creates the longest lines in the diagram.
4. **Room for labels after busy gateways.** A gateway with several branches to the same next column needs
   a gap (`colGap` for its column) at least as wide as the labels that share a stretch — two chips side by
   side need ~250–380px.
5. **Order boundary rows by where they go.** Rows whose edge goes *up* first, then the ones going down to
   the nearest handler, then the farthest. Lines then nest instead of crossing (`boundaryOrder`).
6. **Same target, same trunk.** Several edges into one node may share their last stretch (the router
   prefers it): it reads as "all of these go back to Plan". Edges to *different* targets never share a
   stretch.

## Step 4 — Run the script and look at the result

```
node scripts/kikwi-layout.mjs process.kikwi grid.json process.laid-out.kikwi
```

It prints `{ nodes, edges, crossings, ambiguousSharedSegments, width, height, problems }`. `problems` must
be empty: it lists every edge crossing a card or a name, every label covering a node, a name or another
label, and nodes too close. Then **look at it** — a clean check is necessary, not sufficient. Render the
file in the real canvas (import it in Kikwiflow Craft or open it in the Monitor) and read it as the
business would. Typical fixes, all in the grid: move an end next to its gateway; swap two rows; widen a
gap; reorder boundary rows. `node scripts/kikwi-layout.mjs file.kikwi --check` checks a file laid out by
hand or by an earlier run.

What the script does for you, so you don't fight it:
- In a gateway fan, the branch going farthest is routed first and takes the vertical track closest to the
  diamond; nearer branches nest outside it — no crossings within a fan.
- A branch that changes height turns right after the diamond, so it has a stretch of its own; its label
  goes only on a stretch it doesn't share with a branch to another target (a label on a shared trunk is
  ambiguous). Two branches to the same target get their labels stacked.
- Each gateway branch gets the diamond tip matching its direction (`right-2` up, `right-3` down).

## Step 5 — When layout alone can't fix it

If after a few grid iterations the result is still hard to read — many long lines against the reading
direction, a node absorbing edges from all over — stop polishing. The usual cause is Step 1's repeated
interrupts, or one gateway doing two decisions at once. Deliver the best layout and name the structural
change that would fix it.

## Step 6 — What to deliver

1. The same `.kikwi`, unchanged except for the cosmetic fields in the contract above (diff it if in
   doubt: strip `layout`, `positionHandlers`, `labelPosition`, `sourceHandle` and compare).
2. The grid file you used, so the next pass starts from it instead of from scratch.
3. The script's report and, when you could render it, a picture.
4. A short note naming any place that is still hard to read and the modeling change that would fix it.
