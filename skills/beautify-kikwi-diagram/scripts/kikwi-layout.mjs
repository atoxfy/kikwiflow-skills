// Lays out a .kikwi file for the Kikwiflow canvas. Nodes go on a grid of columns × rows that YOU decide (the
// reading order is a judgment call); this script turns the grid into pixels using the canvas's real geometry,
// routes every edge orthogonally around cards and names, places gateway branch labels where they're unambiguous,
// and then checks the result by simulating exactly how the canvas will draw it.
//
// Usage: node kikwi-layout.mjs <in.kikwi> <grid.json> <out.kikwi>
//        node kikwi-layout.mjs <in.kikwi> --check          (only check the layout already in the file)
// No dependencies (Node 18+). Writes only cosmetic fields: node `layout`, edge `positionHandlers`,
// `labelPosition`, gateway `sourceHandle`, and (if the grid asks) the ORDER of `boundaryEventIds`.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, specPath, output] = process.argv;
const def = JSON.parse(readFileSync(input, 'utf8'));
const N = def.flowNodes;

// ---------- canvas geometry (measured in the modeler at zoom 1) ----------
const TASKS = new Set(['EXECUTABLE_TASK', 'EXTERNAL_TASK', 'AGENT_TASK', 'TIMER_TASK', 'EVENT_CATCHER', 'EVENT_THROWER', 'CALL_ACTIVITY_COORDINATOR']);
const GATEWAYS = new Set(['EXCLUSIVE_GATEWAY', 'PARALLEL_GATEWAY', 'JOIN_GATEWAY']);
const TASK_W = 300, TASK_BASE_H = 104, PORT_Y = 32, ROW0_Y = 129, ROW_STEP = 42, ROWS_EXTRA = 11, FOOTER_H = 32;
const GW = 56, EV = 40;
const textW = (s, px = 7) => [...(s || '')].length * px;

const boundaryIds = new Set(Object.values(N).flatMap((n) => n.boundaryEventIds || []));
const visible = Object.values(N).filter((n) => !boundaryIds.has(n.id));

/** Name drawn below a start/end event or gateway: word-wrapped at ~84px per line, up to 140px wide. */
function nameBox(n) {
  const words = (n.name || '').split(/\s+/).filter(Boolean);
  let lines = 0, cur = 0, widest = 0;
  for (const w of words) {
    const ww = textW(w);
    if (cur === 0 || cur + 4 + ww > 84) { lines++; cur = ww; } else cur += 4 + ww;
    widest = Math.max(widest, cur);
  }
  return { w: Math.min(140, Math.max(60, widest + 16)), h: Math.max(lines, 1) * 16 + 8 };
}

function boundaryRows(n) {
  const evts = (n.boundaryEventIds || []).map((id) => N[id]).filter(Boolean);
  return {
    rows: [...evts.filter((e) => e.type === 'BOUNDARY_ERROR_HANDLER'),
      ...evts.filter((e) => e.type === 'BOUNDARY_NON_INTERRUPTIVE_TIMER'),
      ...evts.filter((e) => e.type === 'BOUNDARY_INTERRUPTIVE_CATCH_EVENT')],
    sla: evts.find((e) => e.type === 'BOUNDARY_INTERRUPTIVE_TIMER'),
  };
}

/** Visual size and outgoing handle positions (relative to the node's top-left corner). */
function shape(n) {
  if (TASKS.has(n.type)) {
    const { rows, sla } = boundaryRows(n);
    const retry = n.type === 'EXECUTABLE_TASK' && n.retryPolicy?.strategy;
    // CALL_ACTIVITY_COORDINATOR also shows the called process key and a progress bar (+44)
    let h = TASK_BASE_H + (n.type === 'CALL_ACTIVITY_COORDINATOR' ? 44 : 0) + (rows.length ? ROWS_EXTRA + ROW_STEP * rows.length : 0);
    if (sla || retry) h += FOOTER_H;
    const out = { out: { x: TASK_W + 2, y: PORT_Y } };
    rows.forEach((r, i) => { out[r.id] = { x: TASK_W + 2, y: ROW0_Y + ROW_STEP * i }; });
    if (sla) out[sla.id] = { x: TASK_W + 2, y: h - 18 };
    return { w: TASK_W, h, inY: PORT_Y, out };
  }
  if (GATEWAYS.has(n.type)) {
    return { w: GW, h: GW, inY: GW / 2, out: { out: { x: GW, y: 28 }, 'right-2': { x: GW - 7, y: 21 }, 'right-3': { x: GW - 7, y: 35 } }, label: nameBox(n), labelTop: 56 };
  }
  return { w: EV, h: EV, inY: EV / 2, out: { out: { x: EV + 6, y: EV / 2 } }, label: nameBox(n), labelTop: 52 };
}
const S = Object.fromEntries(visible.map((n) => [n.id, shape(n)]));

function edgesOf() {
  const list = [];
  for (const n of visible) {
    (n.outgoing || []).forEach((o, i) => list.push({ id: o.id || `${n.id}#${i}`, src: n.id, port: 'out', tgt: o.targetNodeId, flow: o, gateway: n.type === 'EXCLUSIVE_GATEWAY' }));
    for (const bid of n.boundaryEventIds || []) {
      (N[bid]?.outgoing || []).forEach((o, i) => list.push({ id: o.id || `${bid}#${i}`, src: n.id, port: bid, tgt: o.targetNodeId, flow: o, gateway: false }));
    }
  }
  return list;
}
const edges = edgesOf();

function chipSize(e) {
  if (!e.gateway) return null;
  const f = e.flow;
  const badge = f.isDefault ? 'PADRÃO' : f.handlesNull ? 'NULL' : f.expectedAnswer || '';
  const name = f.name || '';
  if (!name && !badge) return null;
  const w = Math.max(textW(name, 6.6), badge ? textW(badge, 6.2) + 22 : 0) + 20;
  return { w: Math.round(w), h: name && badge ? 46 : 28 };
}

// ---------- placement: grid of columns × rows ----------
function place(spec) {
  const cols = {}, rows = {};
  for (const [id, [c, r]] of Object.entries(spec.nodes)) {
    if (!S[id]) throw new Error(`unknown node in grid: ${id}`);
    const s = S[id];
    const above = Math.max(s.inY, 0), below = Math.max(s.h - s.inY, s.label ? s.labelTop + s.label.h - s.inY : 0);
    const width = Math.max(s.w, s.label?.w || 0);
    cols[c] = Math.max(cols[c] || 0, width);
    rows[r] = rows[r] || { above: 0, below: 0 };
    rows[r].above = Math.max(rows[r].above, above);
    rows[r].below = Math.max(rows[r].below, below);
  }
  const missing = visible.filter((n) => !spec.nodes[n.id]).map((n) => n.id);
  if (missing.length) throw new Error(`not placed in grid: ${missing.join(', ')}`);
  const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const colX = {}, rowY = {};
  let x = 0;
  for (let i = colKeys[0]; i <= colKeys[colKeys.length - 1]; i++) {
    const w = cols[i] ?? 0;
    colX[i] = x + w / 2; // column center
    x += w + (spec.colGap?.[i] ?? spec.gapX ?? 150);
  }
  let y = 0, prevBelow = 0;
  for (let i = rowKeys[0]; i <= rowKeys[rowKeys.length - 1]; i++) {
    const r = rows[i] || { above: 0, below: 0 };
    y += (i === rowKeys[0] ? 0 : prevBelow + (spec.rowGap?.[i] ?? spec.gapY ?? 110) + r.above);
    rowY[i] = y; // the row's port line: every node in the row has its input handle exactly here
    prevBelow = r.below;
  }
  for (const [id, [c, r, dx = 0, dy = 0]] of Object.entries(spec.nodes)) {
    const s = S[id];
    const align = spec.align?.[id] || (TASKS.has(N[id].type) ? 'left' : 'center');
    const left = align === 'left' ? colX[c] - cols[c] / 2 : colX[c] - s.w / 2;
    N[id].layout = { x: Math.round(left + dx), y: Math.round(rowY[r] - s.inY + dy) };
  }
}

// ---------- obstacles and handles in the current layout ----------
function rects() {
  const nodes = {}, labels = {};
  for (const n of visible) {
    const s = S[n.id], { x, y } = N[n.id].layout;
    nodes[n.id] = { x, y, w: s.w, h: s.h };
    if (s.label) labels[n.id] = { x: x + s.w / 2 - s.label.w / 2, y: y + s.labelTop, w: s.label.w, h: s.label.h };
  }
  return { nodes, labels };
}
function portOf(e) {
  const s = S[e.src], { x, y } = N[e.src].layout;
  const slot = e.gateway ? ({ 'right-2': 'right-2', 'right-3': 'right-3' }[e.flow.sourceHandle] || 'out') : e.port;
  const p = s.out[slot];
  return { x: x + p.x, y: y + p.y };
}
function targetOf(e) {
  const { x, y } = N[e.tgt].layout;
  return { x: x - 2, y: y + S[e.tgt].inY };
}

// ---------- orthogonal router (A* on a sparse grid) ----------
const M = 22; // clearance kept around nodes
function route(all) {
  const { nodes, labels } = rects();
  const obstacles = [...Object.entries(nodes).map(([id, r]) => ({ id, ...inflate(r, M) })),
    ...Object.entries(labels).map(([id, r]) => ({ id, label: true, ...inflate(r, 6) }))];
  const xs = new Set(), ys = new Set();
  for (const o of obstacles) { xs.add(o.x - 1); xs.add(o.x + o.w + 1); ys.add(o.y - 1); ys.add(o.y + o.h + 1); }
  for (const e of all) { const s = portOf(e), t = targetOf(e); ys.add(s.y); ys.add(t.y); xs.add(s.x + 14); xs.add(t.x - 18); }
  // extra tracks every 16px between obstacles, so several lines can run side by side
  const addTracks = (set) => {
    const v = [...set].sort((a, b) => a - b);
    for (let i = 0; i < v.length - 1; i++) for (let k = v[i] + 16; k < v[i + 1] - 8; k += 16) set.add(k);
  };
  addTracks(xs); addTracks(ys);
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const routed = [];
  for (const e of all) {
    const s = portOf(e), t = targetOf(e);
    const own = (o) => o.id === e.src || o.id === e.tgt;
    const blocked = (a, b) => obstacles.some((o) => {
      if (own(o) && !o.label) {
        // inside its own source/target clearance an edge may only move along the handle's line
        const r = nodes[o.id];
        if (segHitsRect(a, b, r, 1)) return true;
        const inSrcLane = o.id === e.src && Math.abs(a.y - s.y) < 0.5 && Math.abs(b.y - s.y) < 0.5;
        const inTgtLane = o.id === e.tgt && Math.abs(a.y - t.y) < 0.5 && Math.abs(b.y - t.y) < 0.5;
        if (inSrcLane || inTgtLane) return false;
        return segHitsRect(a, b, o, 0);
      }
      return segHitsRect(a, b, o, 0);
    });
    const path = astar(X, Y, s, t, blocked, routed, e);
    if (!path) { console.error(`no route for ${e.id} (${e.src} → ${e.tgt}) — give the grid more room`); continue; }
    routed.push({ e, pts: path });
  }
  return routed;
}
function inflate(r, m) { return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }; }

function astar(X, Y, s, t, blocked, routed, e) {
  const xi = (v) => X.indexOf(v), yi = (v) => Y.indexOf(v);
  const sx = X.find((v) => v >= s.x + 14), gx = [...X].reverse().find((v) => v <= t.x - 18);
  if (sx == null || gx == null || xi(sx) < 0 || yi(s.y) < 0 || yi(t.y) < 0) return null;
  const start = { x: sx, y: s.y }, goal = { x: gx, y: t.y };
  const others = routed.filter((r) => r.e.tgt !== e.tgt);
  const same = routed.filter((r) => r.e.tgt === e.tgt);
  const BEND = 40, CROSS = 90, OVERLAP = 25, SHARE = 0.35;
  const key = (i, j, d) => `${i},${j},${d}`;
  const open = new Heap(), best = new Map(), prev = new Map(), closed = new Set();
  const h = (i, j) => Math.abs(X[i] - goal.x) + Math.abs(Y[j] - goal.y);
  const si = xi(start.x), sj = yi(start.y), gi = xi(goal.x), gj = yi(goal.y);
  const k0 = key(si, sj, 'R');
  best.set(k0, 0); open.push({ k: k0, i: si, j: sj, d: 'R', g: 0, f: h(si, sj) });
  const dirs = { R: [1, 0], L: [-1, 0], D: [0, 1], U: [0, -1] };
  let iter = 0;
  while (open.size && iter++ < 400000) {
    const cur = open.pop();
    const curK = cur.k;
    if (closed.has(curK) || cur.g > (best.get(curK) ?? Infinity)) continue;
    closed.add(curK);
    if (cur.i === gi && cur.j === gj) {
      // edges always enter a node from the left, moving right
      const pts = [t];
      let k = curK;
      const chain = [];
      while (k) { const [i, j] = k.split(',').map(Number); chain.push({ x: X[i], y: Y[j] }); k = prev.get(k); }
      chain.reverse();
      return simplify([s, ...chain, ...pts]);
    }
    for (const [d, [di, dj]] of Object.entries(dirs)) {
      if ((cur.d === 'R' && d === 'L') || (cur.d === 'L' && d === 'R') || (cur.d === 'U' && d === 'D') || (cur.d === 'D' && d === 'U')) continue;
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
      const a = { x: X[cur.i], y: Y[cur.j] }, b = { x: X[ni], y: Y[nj] };
      if (blocked(a, b)) continue;
      const atGoal = ni === gi && nj === gj;
      let len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      let cost = len;
      if (d !== cur.d) cost += BEND;
      // a gateway branch that changes height fans out right after the diamond, so each branch gets a stretch of
      // its own (where its label goes) instead of running alongside its siblings
      if (e.gateway && Math.abs(t.y - s.y) > 1 && Math.abs(a.y - s.y) < 0.5 && Math.abs(b.y - s.y) < 0.5) cost += len * 1.5;
      if (atGoal && d !== 'R' && d !== 'D' && d !== 'U') continue;
      for (const r of others) for (let q = 0; q < r.pts.length - 1; q++) {
        const seg = [r.pts[q], r.pts[q + 1]];
        if (crosses([a, b], seg)) cost += CROSS;
        const ov = collinearOverlap([a, b], seg, 6);
        if (ov > 0) cost += ov * OVERLAP;
      }
      let shared = 0;
      for (const r of same) for (let q = 0; q < r.pts.length - 1; q++) shared = Math.max(shared, collinearOverlap([a, b], [r.pts[q], r.pts[q + 1]], 1));
      if (shared > 0) cost -= shared * (1 - SHARE);
      const nk = key(ni, nj, d);
      const g = cur.g + Math.max(cost, 1);
      if (g < (best.get(nk) ?? Infinity)) {
        best.set(nk, g); prev.set(nk, curK);
        open.push({ k: nk, i: ni, j: nj, d, g, f: g + h(ni, nj) });
      }
    }
  }
  return null;
}
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.5 && Math.abs(out[out.length - 1].y - p.y) < 0.5) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

// ---------- gateway branch labels (chips) ----------
function placeChips(routed) {
  const { nodes, labels } = rects();
  const taken = [...Object.values(nodes).map((r) => inflate(r, 8)), ...Object.values(labels).map((r) => inflate(r, 8))];
  const chips = [];
  // most constrained first (shortest paths)
  const order = routed.filter((r) => chipSize(r.e)).sort((a, b) => pathLen(a.pts) - pathLen(b.pts));
  for (const r of order) {
    const c = chipSize(r.e);
    let bestSpot = null;
    for (let q = 0; q < r.pts.length - 1; q++) {
      const a = r.pts[q], b = r.pts[q + 1];
      const horiz = Math.abs(a.y - b.y) < 0.5;
      const len = horiz ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
      const need = horiz ? c.w + 24 : c.h + 24;
      if (len < need) continue;
      const half = (horiz ? c.w : c.h) / 2 + 10;
      for (let off = half; off <= len - half; off += 6) {
        const ff = off / len;
        const p = { x: a.x + (b.x - a.x) * ff, y: a.y + (b.y - a.y) * ff };
        const box = { x: p.x - c.w / 2, y: p.y - c.h / 2, w: c.w, h: c.h };
        if (taken.some((o) => overlap(box, o, 4)) || chips.some((o) => overlap(box, o, 6))) continue;
        // only on a stretch this edge doesn't share with an edge to another target: on a shared trunk it's ambiguous
        if (routed.some((o) => o !== r && o.e.tgt !== r.e.tgt && onPath(o.pts, box))) continue;
        const score = (horiz ? 0 : 200) + q * 30 + Math.abs(ff - 0.5) * 60;
        if (!bestSpot || score < bestSpot.score) bestSpot = { p, box, score };
      }
    }
    if (!bestSpot) {
      // a sibling with the same target already has its chip on this stretch: stack right below (or above) it
      const sib = order.find((o) => o !== r && o.e.src === r.e.src && o.e.tgt === r.e.tgt && o.e.flow.labelPosition);
      if (sib) {
        const sc = chipSize(sib.e), p0 = sib.e.flow.labelPosition;
        for (const dir of [1, -1]) {
          const p = { x: p0.x, y: p0.y + dir * (sc.h / 2 + c.h / 2 + 4) };
          const box = { x: p.x - c.w / 2, y: p.y - c.h / 2, w: c.w, h: c.h };
          if (taken.some((o) => overlap(box, o, 4)) || chips.some((o) => overlap(box, o, 3))) continue;
          bestSpot = { p, box };
          break;
        }
      }
    }
    if (!bestSpot) { console.error(`no room for the label of ${r.e.id} — widen the gap after its gateway`); continue; }
    chips.push(bestSpot.box);
    r.e.flow.labelPosition = { x: Math.round(bestSpot.p.x), y: Math.round(bestSpot.p.y) };
  }
}
function onPath(pts, box) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (segHitsRect(a, b, { x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 }, 0)) return true;
  }
  return false;
}
const pathLen = (pts) => pts.slice(1).reduce((acc, p, i) => acc + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

// ---------- run ----------
if (specPath !== '--check') {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  // order of boundary rows inside a card (cosmetic): the grid may reorder them
  for (const [id, order] of Object.entries(spec.boundaryOrder || {})) {
    const cur = N[id].boundaryEventIds;
    if (order.length !== cur.length || order.some((b) => !cur.includes(b))) throw new Error(`boundaryOrder of ${id} must be a permutation of ${cur}`);
    N[id].boundaryEventIds = order;
    S[id] = shape(N[id]);
  }
  place(spec);
  for (const e of edges) { delete e.flow.positionHandlers; delete e.flow.labelPosition; if (e.gateway) e.flow.sourceHandle = 'right'; }
  // In a gateway fan, the branch that travels farthest (vertically) is routed first and takes the vertical track
  // closest to the diamond; nearer branches nest outside it, so they don't cross. The first pass picks each
  // gateway branch's exit slot from the direction its route takes; the second pass routes with that slot.
  const spread = (e) => e.gateway ? Math.abs(targetOf(e).y - portOf(e).y) : -1;
  const order = [...edges].sort((a, b) => (spec.priority?.[b.id] ?? 0) - (spec.priority?.[a.id] ?? 0)
    || (a.src === b.src ? spread(b) - spread(a) : 0));
  let routed = route(order);
  for (const r of routed) if (r.e.gateway) {
    const first = r.pts.find((p) => Math.abs(p.y - r.pts[0].y) > 0.5);
    r.e.flow.sourceHandle = !first ? 'right' : first.y < r.pts[0].y ? 'right-2' : 'right-3';
  }
  routed = route(order);
  for (const r of routed) {
    const bends = r.pts.slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    if (bends.length) r.e.flow.positionHandlers = bends;
  }
  placeChips(routed);
  writeFileSync(output, JSON.stringify(def, null, 2) + '\n');
}
console.log(JSON.stringify(check(), null, 1));

// ---------- check: simulate how the canvas draws each edge (react-flow smoothstep per segment) ----------
function check() {
  const { nodes, labels } = rects();
  const problems = [], chips = [], drawn = [];
  for (const e of edges) {
    const pts = smoothRoute(portOf(e), e.flow.positionHandlers || [], targetOf(e));
    drawn.push({ e, pts });
    for (const [id, r] of Object.entries(nodes)) {
      const segs = pts.slice(0, -1).map((p, i) => [p, pts[i + 1]]);
      const inner = (id === e.src || id === e.tgt) ? segs.slice(1, -1) : segs;
      if (inner.some(([a, b]) => segHitsRect(a, b, r, 3))) problems.push(`edge ${e.id} crosses node ${id}`);
    }
    for (const [id, r] of Object.entries(labels)) {
      const segs = pts.slice(0, -1).map((p, i) => [p, pts[i + 1]]);
      if (segs.some(([a, b]) => segHitsRect(a, b, r, 2))) problems.push(`edge ${e.id} crosses the name of ${id}`);
    }
    const c = chipSize(e);
    if (c) {
      const at = e.flow.labelPosition || longestH(pts);
      chips.push({ id: e.id, x: at.x - c.w / 2, y: at.y - c.h / 2, w: c.w, h: c.h });
    }
  }
  for (const c of chips) {
    for (const [id, r] of Object.entries(nodes)) if (overlap(c, r, 2)) problems.push(`label of ${c.id} covers node ${id}`);
    for (const [id, r] of Object.entries(labels)) if (overlap(c, r, 2)) problems.push(`label of ${c.id} covers the name of ${id}`);
    for (const o of chips) if (o.id < c.id && overlap(c, o, 2)) problems.push(`labels of ${c.id} and ${o.id} overlap`);
  }
  const ids = Object.keys(nodes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (overlap(nodes[ids[i]], nodes[ids[j]], 20)) problems.push(`nodes ${ids[i]} and ${ids[j]} touch`);
  }
  for (const [id, r] of Object.entries(labels)) for (const [id2, r2] of Object.entries(nodes)) if (id !== id2 && overlap(r, r2, 4)) problems.push(`name of ${id} touches node ${id2}`);
  let crossings = 0, shared = 0;
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const A = drawn[i], B = drawn[j];
    for (let p = 0; p < A.pts.length - 1; p++) for (let q = 0; q < B.pts.length - 1; q++) {
      const s1 = [A.pts[p], A.pts[p + 1]], s2 = [B.pts[q], B.pts[q + 1]];
      if (crosses(s1, s2)) crossings++;
      if (A.e.tgt !== B.e.tgt && A.e.src !== B.e.src && collinearOverlap(s1, s2, 3) > 10) shared++;
    }
  }
  const all = Object.values(nodes);
  return {
    nodes: visible.length, edges: edges.length, crossings, ambiguousSharedSegments: shared,
    width: Math.max(...all.map((r) => r.x + r.w)) - Math.min(...all.map((r) => r.x)),
    height: Math.max(...all.map((r) => r.y + r.h)) - Math.min(...all.map((r) => r.y)),
    problems,
  };
}

function smoothRoute(s, handlers, t) {
  const pts = [s, ...handlers, t], out = [s];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const horiz = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
    const sPos = i === 0 ? 'R' : horiz ? (b.x > a.x ? 'R' : 'L') : (b.y > a.y ? 'B' : 'T');
    const tPos = i === pts.length - 2 ? 'L' : horiz ? (b.x > a.x ? 'L' : 'R') : (b.y > a.y ? 'T' : 'B');
    for (const p of smoothPoints(a, sPos, b, tPos, i === 0 ? 10 : 0).slice(1)) out.push(p);
  }
  return simplify(out);
}
function smoothPoints(source, sp, target, tp, offset) {
  const DIR = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } };
  const sd = DIR[sp], td = DIR[tp];
  const sg = { x: source.x + sd.x * offset, y: source.y + sd.y * offset };
  const tg = { x: target.x + td.x * offset, y: target.y + td.y * offset };
  const dir = (sp === 'L' || sp === 'R') ? (sg.x < tg.x ? { x: 1, y: 0 } : { x: -1, y: 0 }) : (sg.y < tg.y ? { x: 0, y: 1 } : { x: 0, y: -1 });
  const acc = dir.x !== 0 ? 'x' : 'y', cur = dir[acc];
  const cx = (source.x + target.x) / 2, cy = (source.y + target.y) / 2;
  let points;
  if (sd[acc] * td[acc] === -1) {
    const vs = [{ x: cx, y: sg.y }, { x: cx, y: tg.y }], hs = [{ x: sg.x, y: cy }, { x: tg.x, y: cy }];
    points = sd[acc] === cur ? (acc === 'x' ? vs : hs) : (acc === 'x' ? hs : vs);
  } else {
    const st = [{ x: sg.x, y: tg.y }], ts = [{ x: tg.x, y: sg.y }];
    points = acc === 'x' ? (sd.x === cur ? ts : st) : (sd.y === cur ? st : ts);
    if (sp !== tp) {
      const opp = acc === 'x' ? 'y' : 'x';
      const same = sd[acc] === td[opp], gt = sg[opp] > tg[opp], lt = sg[opp] < tg[opp];
      const flip = (sd[acc] === 1 && ((!same && gt) || (same && lt))) || (sd[acc] !== 1 && ((!same && lt) || (same && gt)));
      if (flip) points = acc === 'x' ? st : ts;
    }
  }
  return [source, sg, ...points, tg, target];
}
function longestH(pts) {
  let best = null, len = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.x - a.x) > len) { len = Math.abs(b.x - a.x); best = { x: (a.x + b.x) / 2, y: b.y }; }
  }
  return best || pts[0];
}
function overlap(a, b, m) { return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y; }
function segHitsRect(a, b, r, m) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return x2 > r.x + m && x1 < r.x + r.w - m && y2 > r.y + m && y1 < r.y + r.h - m;
}
function collinearOverlap([a, b], [c, d], tol) {
  if (Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - c.y) < tol) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  if (Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - c.x) < tol) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  return 0;
}
function crosses([a, b], [c, d]) {
  const h1 = Math.abs(a.y - b.y) < 0.5, h2 = Math.abs(c.y - d.y) < 0.5;
  if (h1 === h2) return false;
  const [H, V] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
  const hx1 = Math.min(H[0].x, H[1].x), hx2 = Math.max(H[0].x, H[1].x), vy1 = Math.min(V[0].y, V[1].y), vy2 = Math.max(V[0].y, V[1].y);
  return V[0].x > hx1 + 1 && V[0].x < hx2 - 1 && H[0].y > vy1 + 1 && H[0].y < vy2 - 1;
}
