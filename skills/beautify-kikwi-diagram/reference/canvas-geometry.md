# Canvas geometry (Kikwiflow Craft / Monitor)

Measured in the modeler at zoom 1 from the rendered DOM (`offsetWidth`/`offsetHeight` of each
`.react-flow__node` and the bounding boxes of its `.react-flow__handle`s), and cross-checked against the
components in the UI monorepo (`packages/flow-nodes`). `layout.x`/`layout.y` is the node's top-left corner.
[`../scripts/kikwi-layout.mjs`](../scripts/kikwi-layout.mjs) encodes exactly these numbers — update both
together if the canvas changes.

## Nodes

| Family | Types | Visual size | Name |
|---|---|---|---|
| Event | `DEFAULT_START_EVENT`, `DEFAULT_END_EVENT` | 40 × 40 | below, from y+52; word-wrapped at ~84px per line, 60–140px wide, 1–3 lines of 16px |
| Gateway | `EXCLUSIVE_GATEWAY`, `PARALLEL_GATEWAY`, `JOIN_GATEWAY` | 56 × 56 | below, from y+56; same wrapping |
| Task card | `EXECUTABLE_TASK`, `EXTERNAL_TASK`, `AGENT_TASK`, `TIMER_TASK`, `EVENT_CATCHER`, `EVENT_THROWER`, `CALL_ACTIVITY_COORDINATOR` | 300 wide | inside the card |

Task card height:

```
104                                   header + stats row
+ 44                                  CALL_ACTIVITY_COORDINATOR only (called process key + progress bar)
+ 11 + 42 × rows    (if rows > 0)     one row per boundary event drawn inside the card, in this order:
                                      BOUNDARY_ERROR_HANDLER, BOUNDARY_NON_INTERRUPTIVE_TIMER,
                                      BOUNDARY_INTERRUPTIVE_CATCH_EVENT (each group in boundaryEventIds order)
+ 32                (if footer)       BOUNDARY_INTERRUPTIVE_TIMER (timeout footer) or an EXECUTABLE_TASK retryPolicy
```

Measured examples: executable task 104; with a retry policy 136; with one error handler 157; timer task
with 3 catch events 241, with 4 catch events 283, with 2 catch events and a timeout 231; call activity 148.

The canvas draws **every** boundary event of a wait as its own row with its own handle. Canvases built
before the fix "desenhar todos os eventos de borda das esperas" (flow-nodes, Nov 2026) drew only the first
`BOUNDARY_INTERRUPTIVE_CATCH_EVENT` of a `TIMER_TASK`/`AGENT_TASK`/`EXTERNAL_TASK` and no timeout on a
`TIMER_TASK`; the other edges had no handle and **React Flow silently did not draw them**. If a diagram
seems to be missing paths, count rendered `.react-flow__edge` elements against the edges in the file.

## Handles (relative to the node's top-left)

| Node | Input (target) | Outputs (source) |
|---|---|---|
| Event | (−2, 20) | `onComplete` (46, 20) |
| Gateway | `left` (−2, 28) | `right` (56, 28), `right-2` (49, 21), `right-3` (49, 35); also `top`/`top-2`/`top-3` and `bottom`/`bottom-2`/`bottom-3` around those tips — avoid the bottom ones, they run through the gateway's name |
| Task card | `onStart` (−2, 32) | `onComplete` (302, 32); boundary row *i* (302, 129 + 42·i), handle id = the boundary event's id; timeout footer (302, h − 18) |

Every edge enters its target through the **left** handle. A gateway edge's tip is the `sourceHandle` saved on
the outgoing flow; without it the canvas infers one from the first waypoint.

## How an edge is drawn

`useEdgePathGeometry.ts` builds the points `[source handle, ...positionHandlers, target handle]` and draws
each consecutive pair with react-flow's `getSmoothStepPath` (corner radius 4; the first pair with a 10px
offset out of the source). The side each intermediate point "leaves" from is inferred from whether that
pair is mostly horizontal or vertical. Consequences:

- Waypoints that form an orthogonal path (each pair shares x or y) produce exactly that path.
- With no waypoints, smoothstep bends halfway between source and target — fine for a straight connection,
  bad for anything that has to go around a card.
- Crossings are drawn with a small "jump" arc on one of the lines.

Labels:
- **Gateway branches** (`GatewayFlowEdge`): a chip with the flow's `name` on the first line and a badge
  (`expectedAnswer`, ⚡ for default, NULL) on the second — about 6.6px per name character, 6.2px per badge
  character + 22, + 20 padding; 44px tall with both lines, 26px with one. Centered on `labelPosition` if
  set, otherwise on the longest horizontal stretch, nudged apart only when sibling labels from the same
  gateway side collide within 28px vertically.
- **Other edges** (`PositionableEdge`): a `name`, if any, near the start of the edge.

## Wire format

`SequenceFlowDefinition` (kikwi-model) carries `positionHandlers` (list of `{x, y}`), `labelPosition`
(`{x, y}`) and `sourceHandle` (string). The engine stores and returns them unchanged, so a layout survives
deploy, export and re-import. They are cosmetic: the engine never reads them to execute.
