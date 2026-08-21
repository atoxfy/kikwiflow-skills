# Reference: structural validity checklist (`document-java-as-kikwi`)

> Loaded from [`../SKILL.md`](../SKILL.md) Step 5. Check every item before considering the file done —
> a `.kikwi` that violates any of these is structurally invalid, even though it's never executed. See
> also [`node-types.md`](node-types.md) for the field-level catalog these checks assume.

- [ ] Syntactically valid JSON (no trailing commas, correct quoting, UTF-8).
- [ ] `defaultStartPoint` points to a node that exists in `flowNodes` and is of type `DEFAULT_START_EVENT`.
- [ ] Every `flowNodes` entry's key is **identical** to the `"id"` field inside that node's own object.
- [ ] Every `targetNodeId` in any `outgoing` points to a key that exists in `flowNodes`.
- [ ] Every `DEFAULT_END_EVENT` has an empty `outgoing`.
- [ ] Every node that isn't `EXCLUSIVE_GATEWAY`/`PARALLEL_GATEWAY` has **at most one** entry in `outgoing`.
- [ ] Every `EXCLUSIVE_GATEWAY` declares `providerType` (`BEAN` or `VARIABLE`) and has at least one exit.
- [ ] No `EXCLUSIVE_GATEWAY` has more than one `isDefault: true` edge, nor more than one `handlesNull: true`.
- [ ] Two outgoing edges of the same `EXCLUSIVE_GATEWAY` never repeat the same `expectedAnswer`.
- [ ] Every `PARALLEL_GATEWAY` declares `targetJoinId` pointing to a node that exists **and** is of type
      `JOIN_GATEWAY`.
- [ ] Every node referenced in `boundaryEventIds` exists in `flowNodes`, and its type is compatible with the
      parent node (see the table in [`node-types.md`](node-types.md)).
- [ ] Every boundary event has `attachedToRef` pointing back to the correct parent node `id`.
- [ ] `CALL_ACTIVITY_COORDINATOR` has `calledElement` filled in; if `elementVariable` is present,
      `collectionVariable` is too.
- [ ] Every node is reachable from `defaultStartPoint` (no "loose" nodes in `flowNodes` that nothing points
      to) — if a code step isn't reached by any path, don't include it, or document why outside the JSON
      (e.g. in the process's `description`).
- [ ] No node/edge/the process root has **both** `kikwi:documentation` and `kikwi:documentationLink` set at
      the same time (see Steps 2/4 of the SKILL — the modeler's toggle only shows one).
- [ ] Every ` ```mermaid ` block inside a `kikwi:documentation` value is valid Mermaid syntax (flowchart/
      sequence diagram) — a reader hitting a broken diagram in the fullscreen preview is worse than no
      diagram at all.
