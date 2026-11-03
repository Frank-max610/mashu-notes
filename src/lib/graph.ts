import type { Note, NoteKind, NotePosition } from './types';
import { buildTitleIndex, extractWikiLinks, normalizeTitle, resolveLink } from './links';

/**
 * Graph model + deterministic force layout for the editable life graph.
 *
 * Everything in this module is pure and DOM-free: `buildGraph` derives nodes and
 * edges from note content, hand-drawn links and same-day life records, and the
 * layout helpers mutate a `Graph` in place with plain arithmetic (no
 * `Math.random`, no time, no canvas) so results are stable across renders and
 * testable in Node.
 */

export type GraphEdgeType = 'wiki' | 'manual' | 'day' | 'directory';

export interface GraphNode {
  id: string;
  title: string;
  ghost: boolean;
  /** Life-record kind; ghosts are always plain `note`s. */
  kind: NoteKind;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** True when a saved user position pins this node in place. */
  fixed: boolean;
  /** Saved normalised position copied from the note (0..1), when present. */
  position?: NotePosition;
  /** True for directory hub nodes (user-created knowledge-base folders). */
  directory?: boolean;
  /** Warm directory colour assigned by the user (hubs; inherited by members). */
  dirColor?: string;
  /** Directory hub this note belongs to (members only). */
  dirId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Derived from `[[wiki links]]`, hand-drawn, or same-day life records. */
  type: GraphEdgeType;
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
/** Saved positions are kept a little inside the canvas edges. */
const FIXED_MARGIN_RATIO = 0.04;
const FIXED_MARGIN_MAX = 12;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Copy a saved position safely (clamped to 0..1) or return undefined. */
function readPosition(position: NotePosition | undefined): NotePosition | undefined {
  if (!position || typeof position !== 'object') return undefined;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function createNode(
  id: string,
  title: string,
  ghost: boolean,
  kind: NoteKind,
  position?: NotePosition,
): GraphNode {
  return {
    id,
    title,
    ghost,
    kind,
    degree: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fixed: position !== undefined,
    ...(position ? { position } : {}),
  };
}

/** Undirected edge key: `A→B` and `B→A` dedupe to the same edge. */
function edgeKey(sourceId: string, targetId: string): string {
  return sourceId < targetId ? `${sourceId}\u0000${targetId}` : `${targetId}\u0000${sourceId}`;
}

/** Timestamp used for same-day chains: when the record happened, else creation. */
function dayTimestamp(note: Note): number {
  const occurredAt = note.meta?.occurredAt;
  if (typeof occurredAt === 'number' && Number.isFinite(occurredAt)) return occurredAt;
  return note.createdAt;
}

/** Local calendar day key, e.g. `2026-3-5`. */
function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Derive the editable life graph from the vault.
 *
 * - One node per note, carrying its kind and optional saved position.
 * - Wiki edges from `[[links]]` (dangling targets become ghost nodes).
 * - Manual edges from `note.manualLinks` (resolved by note id, undirected).
 * - Day edges along same-day life records (`kind !== 'note'`), consecutive only.
 * - Directory edges from each note's `dirId` to its directory hub.
 * - Directory notes are hubs (their links never become wiki/manual edges);
 *   archived records and plan items stay out of the graph entirely.
 * - Pairs are deduped: manual beats wiki, day never duplicates an existing pair.
 * - Self links are skipped and `degree` counts all unique incident edges.
 */
export function buildGraph(notes: Note[]): Graph {
  const index = buildTitleIndex(notes);
  const uniqueNotes: Note[] = [];
  const seenNoteIds = new Set<string>();
  for (const note of notes) {
    if (!note || !note.id || seenNoteIds.has(note.id)) continue;
    // Quiet notes never become graph nodes: archived records and plan items.
    if (note.archivedAt || note.meta?.plan) continue;
    seenNoteIds.add(note.id);
    uniqueNotes.push(note);
  }

  const directoryIds = new Set<string>();
  for (const note of uniqueNotes) {
    if (note.meta?.directory) directoryIds.add(note.id);
  }

  const nodes: GraphNode[] = [];
  const nodeById = new Map<string, GraphNode>();
  for (const note of uniqueNotes) {
    const node = createNode(
      note.id,
      note.title,
      false,
      note.kind ?? 'note',
      readPosition(note.position),
    );
    node.directory = directoryIds.has(note.id);
    if (node.directory) {
      const color = note.meta?.directory?.color;
      if (typeof color === 'string' && color.trim()) node.dirColor = color.trim();
    } else if (note.dirId && note.dirId !== note.id && directoryIds.has(note.dirId)) {
      node.dirId = note.dirId;
    }
    nodes.push(node);
    nodeById.set(note.id, node);
  }

  const edges: GraphEdge[] = [];
  const edgeByKey = new Map<string, GraphEdge>();
  // Insertion order of this Map is the ghosts' first-seen order.
  const ghosts = new Map<string, GraphNode>();

  const addEdge = (sourceId: string, targetId: string, type: GraphEdgeType): void => {
    const key = edgeKey(sourceId, targetId);
    if (edgeByKey.has(key)) return;
    const edge: GraphEdge = { source: sourceId, target: targetId, type };
    edgeByKey.set(key, edge);
    edges.push(edge);
  };

  // ---- wiki edges (`[[links]]` in note content) ----
  for (const note of uniqueNotes) {
    const source = nodeById.get(note.id);
    // Directory hubs only connect through their members, never through content.
    if (!source || source.directory) continue;
    for (const link of extractWikiLinks(note.content)) {
      const resolved = resolveLink(link.target, index);
      let target = resolved ? nodeById.get(resolved.id) : undefined;
      // Links into quiet notes (archived / plan) stay quiet instead of ghosting.
      if (resolved && !target) continue;

      if (!target) {
        const key = normalizeTitle(link.target);
        if (!key) continue;
        const ghostId = `ghost:${key}`;
        const existing = ghosts.get(ghostId);
        if (existing) {
          target = existing;
        } else {
          const ghost = createNode(ghostId, link.target.trim(), true, 'note');
          ghosts.set(ghostId, ghost);
          target = ghost;
        }
      }

      if (target.id === source.id) continue;
      // Directory notes are hubs; their relations come from `dirId`, not links.
      if (target.directory) continue;
      addEdge(source.id, target.id, 'wiki');
    }
  }

  // ---- manual edges (hand-drawn links; they win over a wiki edge on the pair) ----
  for (const note of uniqueNotes) {
    const source = nodeById.get(note.id);
    if (!source || source.directory) continue;
    const links = Array.isArray(note.manualLinks) ? note.manualLinks : [];
    for (const targetId of links) {
      if (typeof targetId !== 'string') continue;
      const target = nodeById.get(targetId);
      if (!target || target.directory || target.id === source.id) continue;
      const key = edgeKey(source.id, target.id);
      const existing = edgeByKey.get(key);
      if (existing) {
        if (existing.type === 'wiki') existing.type = 'manual';
        continue;
      }
      addEdge(source.id, target.id, 'manual');
    }
  }

  // ---- day edges (life records chained in chronological order per local day) ----
  const dayGroups = new Map<string, Array<{ node: GraphNode; timestamp: number }>>();
  for (const note of uniqueNotes) {
    if ((note.kind ?? 'note') === 'note') continue;
    const node = nodeById.get(note.id);
    if (!node || node.directory) continue;
    const timestamp = dayTimestamp(note);
    const key = localDayKey(timestamp);
    const group = dayGroups.get(key);
    if (group) group.push({ node, timestamp });
    else dayGroups.set(key, [{ node, timestamp }]);
  }
  for (const group of dayGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.timestamp - b.timestamp || a.node.id.localeCompare(b.node.id));
    for (let i = 1; i < group.length; i += 1) {
      const previous = group[i - 1];
      const current = group[i];
      if (!previous || !current || previous.node.id === current.node.id) continue;
      addEdge(previous.node.id, current.node.id, 'day');
    }
  }

  // ---- directory edges (each assigned note hangs off its directory hub) ----
  for (const note of uniqueNotes) {
    const node = nodeById.get(note.id);
    if (!node || node.directory || !node.dirId) continue;
    const directory = nodeById.get(node.dirId);
    if (!directory || !directory.directory) continue;
    addEdge(node.id, directory.id, 'directory');
  }

  for (const ghost of ghosts.values()) nodes.push(ghost);

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
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

/** Pixels a saved (fixed) node must stay away from the canvas edges. */
function fixedMarginX(width: number): number {
  return Math.min(FIXED_MARGIN_MAX, width * FIXED_MARGIN_RATIO);
}

function fixedMarginY(height: number): number {
  return Math.min(FIXED_MARGIN_MAX, height * FIXED_MARGIN_RATIO);
}

/**
 * Deterministic directory-aware starting positions, centered in `width` × `height`.
 *
 * Directory hubs sit on a ring (one branch per directory), members start around
 * their directory, and everything else falls back to the even golden spiral.
 * Nodes with a saved position are pinned there (normalised canvas space) and
 * marked `fixed`; the rest stay free. No randomness, so layouts are stable.
 */
export function seedPositions(graph: Graph, width: number, height: number): void {
  const count = graph.nodes.length;
  if (count === 0) return;

  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const scaleY = layoutScaleY(w, h);
  const domainY = h * scaleY;
  const padX = fixedMarginX(w);
  const padY = fixedMarginY(h);
  const maxX = Math.max(padX, w - padX);
  const maxY = Math.max(padY, h - padY);
  const centerX = w / 2;
  const centerY = domainY / 2;
  const pad = Math.min(28, w / 4, domainY / 4);
  const radiusX = Math.max(0, w / 2 - pad);
  const radiusY = Math.max(0, domainY / 2 - pad);
  const clampX = (x: number): number => clamp(x, pad, Math.max(pad, w - pad));
  const clampLayoutY = (y: number): number => clamp(y, pad, Math.max(pad, domainY - pad));

  // Saved positions win: pin them in canvas pixels and keep them fixed.
  const seeded = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.position) continue;
    node.x = clamp(node.position.x * w, padX, maxX);
    node.y = clamp(node.position.y * h, padY, maxY);
    node.fixed = true;
    node.vx = 0;
    node.vy = 0;
    seeded.add(node.id);
  }

  // Directory hubs on a ring: N directories read as N branches.
  const directories = graph.nodes
    .filter((node) => node.directory && !seeded.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const ringRadius = Math.max(24, Math.min(radiusX, radiusY) * 0.66);
  directories.forEach((node, index) => {
    node.fixed = false;
    if (directories.length === 1) {
      node.x = centerX;
      node.y = centerY / scaleY;
    } else {
      const angle = -Math.PI / 2 + (index / directories.length) * Math.PI * 2;
      node.x = clampX(centerX + Math.cos(angle) * ringRadius);
      node.y = clampLayoutY(centerY + Math.sin(angle) * ringRadius) / scaleY;
    }
    node.vx = 0;
    node.vy = 0;
    seeded.add(node.id);
  });

  // Members start in a small orbit around their directory hub.
  const membersByDirectory = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!node.dirId || node.directory || seeded.has(node.id)) continue;
    const members = membersByDirectory.get(node.dirId);
    if (members) members.push(node);
    else membersByDirectory.set(node.dirId, [node]);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const [dirId, members] of membersByDirectory) {
    const directory = nodeById.get(dirId);
    if (!directory || !directory.directory) continue;
    members.sort((a, b) => a.id.localeCompare(b.id));
    const directoryLayoutY = directory.y * scaleY;
    members.forEach((node, index) => {
      const angle = index * GOLDEN_ANGLE + (dirId.charCodeAt(0) % 7) * 0.21;
      const distance = 30 + Math.sqrt(index + 1) * 22;
      node.fixed = false;
      node.x = clampX(directory.x + Math.cos(angle) * distance);
      node.y = clampLayoutY(directoryLayoutY + Math.sin(angle) * distance) / scaleY;
      node.vx = 0;
      node.vy = 0;
      seeded.add(node.id);
    });
  }

  // Everything else (unassigned notes, ghosts) keeps the even spiral.
  const rest = graph.nodes.filter((node) => !seeded.has(node.id));
  rest.forEach((node, index) => {
    node.fixed = false;
    if (count === 1) {
      node.x = centerX;
      node.y = centerY / scaleY;
    } else {
      const fraction = Math.sqrt((index + 0.5) / rest.length);
      const angle = index * GOLDEN_ANGLE;
      node.x = clampX(centerX + Math.cos(angle) * radiusX * fraction);
      node.y = clampLayoutY(centerY + Math.sin(angle) * radiusY * fraction) / scaleY;
    }
    node.vx = 0;
    node.vy = 0;
  });
}

/**
 * Advance the force simulation by one step, in place.
 *
 * O(n²) repulsion + spring attraction along edges + mild centering, integrated
 * with velocity damping and clamped to the padded bounds. Forces are computed in
 * a square layout space (see `layoutScaleY`) so a portrait phone gets a layout
 * that fills the height instead of a flat horizontal band. Fixed (saved) nodes
 * never move; all intermediate values are guarded so coordinates stay finite.
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

    // Saved positions stay exactly where the user put them.
    if (node.fixed) {
      if (!Number.isFinite(node.x)) node.x = centerX;
      if (!Number.isFinite(node.y)) node.y = centerY / scaleY;
      node.vx = 0;
      node.vy = 0;
      continue;
    }

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
