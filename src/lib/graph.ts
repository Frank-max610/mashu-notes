import type { Note } from './types';
import { buildTitleIndex, extractWikiLinks, normalizeTitle, resolveLink } from './links';

/**
 * Graph model + deterministic force layout for the graph view.
 *
 * Everything in this module is pure and DOM-free: `buildGraph` derives nodes and
 * edges from note content, and the layout helpers mutate a `Graph` in place with
 * plain arithmetic (no `Math.random`, no time, no canvas) so results are stable
 * across renders and testable in Node.
 */

export interface GraphNode {
  id: string;
  title: string;
  ghost: boolean;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Golden angle (~137.5°): seeded points spread evenly on a spiral. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Force tuning. Velocities are in CSS pixels per tick; damping keeps it stable.
const REPULSION = 1400;
const SPRING_STRENGTH = 0.008;
const SPRING_REST = 64;
const CENTER_STRENGTH = 0.0018;
const DAMPING = 0.8;
const MAX_SPEED = 16;
const EPSILON = 0.01;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createNode(id: string, title: string, ghost: boolean): GraphNode {
  return { id, title, ghost, degree: 0, x: 0, y: 0, vx: 0, vy: 0 };
}

/** Undirected edge key: `A→B` and `B→A` dedupe to the same parallel edge. */
function edgeKey(sourceId: string, targetId: string): string {
  return sourceId < targetId ? `${sourceId}\u0000${targetId}` : `${targetId}\u0000${sourceId}`;
}

/**
 * Derive the note graph from vault content.
 *
 * - One node per note, `ghost: false`, in vault order.
 * - Every unique `[[wiki link]]` target becomes one edge: resolved links point at
 *   the matching note, dangling targets become `ghost:<normalized title>` nodes
 *   appended in first-seen order.
 * - Self links are skipped; parallel edges are deduped regardless of direction.
 * - `degree` is the number of unique incident edges.
 */
export function buildGraph(notes: Note[]): Graph {
  const index = buildTitleIndex(notes);
  const uniqueNotes: Note[] = [];
  const seenNoteIds = new Set<string>();
  for (const note of notes) {
    if (!note || !note.id || seenNoteIds.has(note.id)) continue;
    seenNoteIds.add(note.id);
    uniqueNotes.push(note);
  }

  const nodes: GraphNode[] = [];
  const nodeById = new Map<string, GraphNode>();
  for (const note of uniqueNotes) {
    const node = createNode(note.id, note.title, false);
    nodes.push(node);
    nodeById.set(note.id, node);
  }

  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const degree = new Map<string, number>();
  // Insertion order of this Map is the ghosts' first-seen order.
  const ghosts = new Map<string, GraphNode>();

  for (const note of uniqueNotes) {
    const source = nodeById.get(note.id);
    if (!source) continue;
    for (const link of extractWikiLinks(note.content)) {
      const resolved = resolveLink(link.target, index);
      let target = resolved ? nodeById.get(resolved.id) : undefined;

      if (!target) {
        const key = normalizeTitle(link.target);
        if (!key) continue;
        const ghostId = `ghost:${key}`;
        const existing = ghosts.get(ghostId);
        if (existing) {
          target = existing;
        } else {
          const ghost = createNode(ghostId, link.target.trim(), true);
          ghosts.set(ghostId, ghost);
          target = ghost;
        }
      }

      if (target.id === source.id) continue;

      const key = edgeKey(source.id, target.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ source: source.id, target: target.id });
      degree.set(source.id, (degree.get(source.id) ?? 0) + 1);
      degree.set(target.id, (degree.get(target.id) ?? 0) + 1);
    }
  }

  for (const ghost of ghosts.values()) nodes.push(ghost);
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;

  return { nodes, edges };
}

/**
 * Map the canvas to a square "layout space": y is multiplied by this factor so
 * forces spread evenly in portrait and landscape instead of collapsing into a
 * circular blob that only fills the shorter axis. Clamped for extreme aspects.
 */
function layoutScaleY(width: number, height: number): number {
  const ratio = height > 0 ? width / height : 1;
  return clamp(ratio, 0.25, 4);
}

/**
 * Deterministic radial/spiral starting positions, centered in `width` × `height`.
 * The spiral is seeded in the square layout space (elliptically in screen space)
 * and every point is clamped inside the padded rectangle.
 */
export function seedPositions(graph: Graph, width: number, height: number): void {
  const count = graph.nodes.length;
  if (count === 0) return;

  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const scaleY = layoutScaleY(w, h);
  const domainY = h * scaleY;
  const pad = Math.min(28, w / 4, domainY / 4);
  const centerX = w / 2;
  const centerY = domainY / 2;
  const radiusX = Math.max(0, w / 2 - pad);
  const radiusY = Math.max(0, domainY / 2 - pad);

  for (let i = 0; i < count; i += 1) {
    const node = graph.nodes[i];
    if (count === 1) {
      node.x = centerX;
      node.y = centerY / scaleY;
    } else {
      // sqrt() spreads the samples evenly over the disk instead of clustering
      // at the center.
      const fraction = Math.sqrt((i + 0.5) / count);
      const angle = i * GOLDEN_ANGLE;
      node.x = clamp(centerX + Math.cos(angle) * radiusX * fraction, pad, Math.max(pad, w - pad));
      node.y =
        clamp(centerY + Math.sin(angle) * radiusY * fraction, pad, Math.max(pad, domainY - pad)) /
        scaleY;
    }
    node.vx = 0;
    node.vy = 0;
  }
}

/**
 * Advance the force simulation by one step, in place.
 *
 * O(n²) repulsion + spring attraction along edges + mild centering, integrated
 * with velocity damping and clamped to the padded bounds. Forces are computed in
 * a square layout space (see `layoutScaleY`) so a portrait phone gets a layout
 * that fills the height instead of a flat horizontal band. All intermediate
 * values are guarded so coordinates always stay finite.
 *
 * Note: `vx` / `vy` are velocities in layout-space units, not screen pixels.
 */
export function tick(graph: Graph, width: number, height: number): void {
  const nodes = graph.nodes;
  const count = nodes.length;
  if (count === 0) return;

  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const scaleY = layoutScaleY(w, h);
  const domainY = h * scaleY;
  const centerX = w / 2;
  const centerY = domainY / 2;
  const pad = Math.min(18, w * 0.08, domainY * 0.08);
  const minX = Math.min(pad, w / 2);
  const maxX = Math.max(minX, w - pad);
  const minY = Math.min(pad, domainY / 2);
  const maxY = Math.max(minY, domainY - pad);

  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);

  const indexById = new Map<string, number>();
  for (let i = 0; i < count; i += 1) indexById.set(nodes[i].id, i);

  // Layout-space coordinates: x stays in screen pixels, y is stretched so the
  // [width] × [height] canvas becomes a [width] × [width] square.
  const layoutX = new Float64Array(count);
  const layoutY = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    layoutX[i] = nodes[i].x;
    layoutY[i] = nodes[i].y * scaleY;
  }

  // Pairwise repulsion: force = REPULSION / distance² (capped later by MAX_SPEED).
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      let dx = layoutX[i] - layoutX[j];
      let dy = layoutY[i] - layoutY[j];
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < EPSILON * EPSILON) {
        // Coincident nodes: push apart along a deterministic direction so the
        // result never depends on iteration order alone.
        const angle = (i * 2.399963 + j * 1.3247) % (Math.PI * 2);
        dx = Math.cos(angle) * EPSILON;
        dy = Math.sin(angle) * EPSILON;
        distanceSq = EPSILON * EPSILON;
      }
      const distance = Math.sqrt(distanceSq);
      const force = REPULSION / distanceSq;
      const ux = dx / distance;
      const uy = dy / distance;
      forceX[i] += ux * force;
      forceY[i] += uy * force;
      forceX[j] -= ux * force;
      forceY[j] -= uy * force;
    }
  }

  // Spring attraction along edges.
  for (const edge of graph.edges) {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const dx = layoutX[targetIndex] - layoutX[sourceIndex];
    const dy = layoutY[targetIndex] - layoutY[sourceIndex];
    const distance = Math.sqrt(dx * dx + dy * dy) || EPSILON;
    const force = (distance - SPRING_REST) * SPRING_STRENGTH;
    const ux = dx / distance;
    const uy = dy / distance;
    forceX[sourceIndex] += ux * force;
    forceY[sourceIndex] += uy * force;
    forceX[targetIndex] -= ux * force;
    forceY[targetIndex] -= uy * force;
  }

  // Centering + integration (all in layout space).
  for (let i = 0; i < count; i += 1) {
    const node = nodes[i];
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      layoutX[i] = centerX;
      layoutY[i] = centerY;
      node.vx = 0;
      node.vy = 0;
    }

    forceX[i] += (centerX - layoutX[i]) * CENTER_STRENGTH;
    forceY[i] += (centerY - layoutY[i]) * CENTER_STRENGTH;

    let vx = (node.vx + forceX[i]) * DAMPING;
    let vy = (node.vy + forceY[i]) * DAMPING;
    if (!Number.isFinite(vx)) vx = 0;
    if (!Number.isFinite(vy)) vy = 0;

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > MAX_SPEED) {
      vx = (vx / speed) * MAX_SPEED;
      vy = (vy / speed) * MAX_SPEED;
    }

    let x = layoutX[i] + vx;
    let y = layoutY[i] + vy;
    if (!Number.isFinite(x)) x = centerX;
    if (!Number.isFinite(y)) y = centerY;

    if (x < minX) {
      x = minX;
      vx = 0;
    } else if (x > maxX) {
      x = maxX;
      vx = 0;
    }
    if (y < minY) {
      y = minY;
      vy = 0;
    } else if (y > maxY) {
      y = maxY;
      vy = 0;
    }

    node.vx = vx;
    node.vy = vy;
    node.x = x;
    node.y = y / scaleY;
  }
}

/** Seed positions and run `iterations` synchronous force steps (reduced motion). */
export function layoutSync(
  graph: Graph,
  width: number,
  height: number,
  iterations = 120,
): Graph {
  seedPositions(graph, width, height);
  const steps = Number.isFinite(iterations) ? Math.max(0, Math.floor(iterations)) : 0;
  for (let i = 0; i < steps; i += 1) tick(graph, width, height);
  return graph;
}
