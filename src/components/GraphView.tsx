import { useEffect, useRef, useState } from 'react';
import type { Note, NoteKind, NotePosition } from '../lib/types';
import { buildGraph, seedPositions } from '../lib/graph';
import type { Graph, GraphNode } from '../lib/graph';
import { directoryList, isDirectory } from '../lib/directories';
import { NOTE_KINDS } from '../lib/kinds';
import { Icon } from './Icon';
import './GraphView.css';

/**
 * P1 force-directed life graph (design doc §10) + user directories (v0.10).
 *
 * A warm, near-fullscreen canvas with a living force simulation: node drag moves
 * the node and lets neighbours respond in real time, then reheats the simulation
 * on release so the map re-balances around the saved position. Hover reveals the
 * first-degree neighbourhood (everything else dims) and selects open a compact
 * bottom node inspector.
 *
 * User-created knowledge-base directories become coloured hub nodes: members
 * inherit their directory colour and cluster weakly around the hub, so N
 * directories read as N branches. A 目录/记录 toggle switches to a pure
 * directory view (hubs + cross-directory relations derived from member links),
 * and directory selection opens a member-list inspector.
 */

export interface GraphViewProps {
  notes: Note[];
  /** Note currently open in the editor (subtle dashed marker). */
  activeNoteId?: string | null;
  /** Node selected for the inspector (subtle ring + neighbourhood focus). */
  selectedNoteId?: string | null;
  onSelectNote: (id: string | null) => void;
  /** Opens the note editor (inspector 编辑, double-tap, connection taps). */
  onOpenNote?: (id: string) => void;
  /** Drag end: persist the node's normalised position (0..1). */
  onMoveNote: (id: string, position: NotePosition) => void;
  /** Add mode: create a note at a normalised canvas position (0..1). */
  onCreateNoteAt: (position: NotePosition) => void;
  /** Connect mode: draw a manual link between two notes. */
  onLinkNotes: (sourceId: string, targetId: string) => void;
  /** Toolbar "重新布局": App/store clears saved positions. */
  onRequestResetLayout?: () => void;
  /** Optional: inspector 删除 action (hidden when absent). */
  onDeleteNote?: (id: string) => void;
  /** Immersive explore state: App makes the host full-bleed and hides nav. */
  fullscreen?: boolean;
  /** App toggles immersive explore (button hidden when absent). */
  onToggleFullscreen?: () => void;
  /** Optional: directory inspector "打开目录" action (hidden when absent). */
  onOpenDirectory?: (id: string) => void;
  /** Directory-network mode: nodes are only user-created directories. */
  directoriesOnly?: boolean;
  /** Optional: empty directory graph CTA. */
  onCreateDirectory?: () => void;
}

type GraphMode = 'idle' | 'add' | 'connect';

interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

interface CanvasSize {
  width: number;
  height: number;
}

interface PointerInfo {
  /** Latest position in canvas coordinates. */
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  /** True when this pointer took part in a pinch (never a tap afterwards). */
  multi: boolean;
}

interface DragState {
  pointerId: number;
  nodeId: string;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
  moved: boolean;
  startedAt: number;
}

interface PinchState {
  distance: number;
  midX: number;
  midY: number;
  scale: number;
  tx: number;
  ty: number;
}

interface InspectorContact {
  id: string;
  title: string;
  outgoing: boolean;
  exists: boolean;
}

/** Warm canvas palette read from the P1 design tokens. */
interface Palette {
  panel: string;
  surface: string;
  border: string;
  edge: string;
  ghost: string;
  accent: string;
  text: string;
  textMuted: string;
  fontSans: string;
  kindColors: Record<NoteKind, string>;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
const TAP_SLOP = 8;
const TAP_TIME = 350;
const DOUBLE_TAP_MS = 320;
const LABEL_FONT_SIZE = 11;
const FOCUS_LABEL_FONT_SIZE = 12;
const MAX_LABEL_CHARS = 14;
/** Below this zoom labels are hidden (canvas gets too small to read). */
const LABEL_MIN_SCALE = 0.42;
/** Nodes stay this far from the canvas edges when free. */
const NODE_MARGIN_MAX = 12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ADDED_NODE_SETTLE_ALPHA = 0.32;

/**
 * Force tuning (design doc §10 ranges): charge -90..-160 style repulsion,
 * link distance 56-110, link strength 0.16-0.34, collision 8-14px and
 * velocity decay 0.38-0.55.
 */
const FORCE = {
  repulsion: 3400,
  linkDistance: 82,
  linkStrength: 0.014,
  centerStrength: 0.0018,
  clusterStrength: 0.0045,
  collisionPadding: 11,
  velocityDecay: 0.45,
  alphaDecay: 0.965,
  alphaMin: 0.015,
  maxSpeed: 24,
  initialAlpha: 1,
  dragAlpha: 0.3,
  releaseAlpha: 0.42,
  /** Directory hubs are anchored on a ring so each directory owns a branch. */
  directoryAnchorStrength: 0.03,
  directoryCenterStrength: 0.003,
  /** Members weakly orbit their hub (link springs add the rest). */
  memberAttraction: 0.012,
  memberKindNudge: 0.0018,
  directoryLinkDistance: 96,
  directoryLinkStrength: 0.02,
  hubRepulsionBoost: 1.6,
};

/** Fallback when a directory note has no colour yet. */
const DEFAULT_DIRECTORY_COLOR = '#7d7164';

/** Kind → warm category token. */
const KIND_COLOR_VARS: Record<NoteKind, string> = {
  diary: '--kind-diary',
  food: '--kind-food',
  health: '--kind-health',
  finance: '--kind-finance',
  note: '--kind-note',
};

/** Kind → legend label. */
const KIND_LABELS: Record<NoteKind, string> = {
  diary: '日记',
  food: '饮食',
  health: '健康',
  finance: '理财',
  note: '笔记',
};

const FALLBACK_KIND_COLORS: Record<NoteKind, string> = {
  diary: '#5c6f80',
  food: '#a8522c',
  health: '#556e43',
  finance: '#85611a',
  note: '#6e6357',
};

const FALLBACK_PALETTE: Palette = {
  panel: '#f7f3ec',
  surface: '#fcfaf6',
  border: '#e5dbcf',
  edge: 'rgba(117, 109, 99, 0.28)',
  ghost: '#cbbfb2',
  accent: '#c8783f',
  text: '#2c2925',
  textMuted: '#756d63',
  fontSans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif",
  kindColors: FALLBACK_KIND_COLORS,
};
const FALLBACK_RGBA: Rgba = { r: 44, g: 41, b: 37, a: 1 };

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Parse `#rgb`, `#rrggbb`, `rgb()` and `rgba()` tokens into channels. */
function parseColor(input: string): Rgba | null {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const raw = hex[1] ?? '';
    const full =
      raw.length === 3
        ? raw
            .split('')
            .map((part) => part + part)
            .join('')
        : raw;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(value);
  if (rgb) {
    const alphaRaw = rgb[4];
    let alpha = 1;
    if (alphaRaw) {
      alpha = alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
    }
    return {
      r: parseFloat(rgb[1] ?? '0'),
      g: parseFloat(rgb[2] ?? '0'),
      b: parseFloat(rgb[3] ?? '0'),
      a: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1,
    };
  }
  return null;
}

/** CSS `rgba()` string with an explicit alpha (works for hex and rgb tokens). */
function colorToRgba(input: string, alpha = 1): string {
  const color = parseColor(input) ?? FALLBACK_RGBA;
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${clamp(alpha, 0, 1)})`;
}

/** djb2 string hash: small and fast, only used to detect content changes. */
function hashString(input: string): number {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

function noteKind(note: Note): NoteKind {
  return note.kind ?? 'note';
}

/** Fingerprint of everything the graph depends on. */
function fingerprintNotes(notes: Note[]): string {
  const parts: string[] = [];
  for (const note of notes) {
    const position = note.position;
    parts.push(
      [
        note.id,
        note.title,
        note.content.length,
        hashString(note.content),
        noteKind(note),
        note.meta?.occurredAt ?? '',
        note.createdAt,
        (note.manualLinks ?? []).join(','),
        position ? `${position.x.toFixed(4)},${position.y.toFixed(4)}` : '',
      ].join('\u0001'),
    );
  }
  return parts.join('\u0002');
}

/** Node size grows with the number of connections. */
function radiusForDegree(degree: number): number {
  return 5 + Math.min(9, Math.sqrt(Math.max(0, degree)) * 2.4);
}

function truncateLabel(title: string, max = MAX_LABEL_CHARS): string {
  const text = title.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Plain-text excerpt for the inspector (light markdown stripping). */
function excerptOf(content: string, max = 150): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^[\]|]+?)(?:\|([^[\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** High-degree nodes that keep their labels visible by default (sparse). */
function importantNodeIds(graph: Graph): Set<string> {
  const count = Math.max(4, Math.min(10, Math.round(graph.nodes.length * 0.16)));
  const ranked = graph.nodes
    .filter((node) => !node.ghost)
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
  const ids = new Set<string>();
  for (const node of ranked) {
    if (ids.size >= count) break;
    ids.add(node.id);
  }
  return ids;
}

/** First-degree neighbours of a node. */
function neighbourIds(graph: Graph, id: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === id) ids.add(edge.target);
    else if (edge.target === id) ids.add(edge.source);
  }
  return ids;
}

/** Directory hubs, ordered deterministically so anchors never jump around. */
function directoryNodes(graph: Graph): GraphNode[] {
  return graph.nodes.filter((node) => node.directory).sort((a, b) => a.id.localeCompare(b.id));
}

/** Directory hub id → warm colour (every hub has one, with a quiet fallback). */
function directoryColorMap(graph: Graph): Map<string, string> {
  const colors = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!node.directory) continue;
    colors.set(node.id, node.dirColor || DEFAULT_DIRECTORY_COLOR);
  }
  return colors;
}

/** Directory hubs are bigger than regular notes (they anchor whole branches). */
function nodeRadius(node: GraphNode): number {
  const base = radiusForDegree(node.degree);
  return node.directory ? base + 4.5 : base;
}

interface CrossDirectoryEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Directory-view relations: member wiki/manual links that cross two different
 * directories, deduped per directory pair. Pure + deterministic.
 */
function crossDirectoryEdges(graph: Graph, directoryIds: Set<string>): CrossDirectoryEdge[] {
  const nodeById = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodeById.set(node.id, node);
  const pairs = new Map<string, CrossDirectoryEdge>();
  for (const edge of graph.edges) {
    if (edge.type !== 'wiki' && edge.type !== 'manual') continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const from = source.dirId;
    const to = target.dirId;
    if (!from || !to || from === to) continue;
    if (!directoryIds.has(from) || !directoryIds.has(to)) continue;
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    const existing = pairs.get(key);
    if (existing) existing.weight += 1;
    else pairs.set(key, { source: from, target: to, weight: 1 });
  }
  return [...pairs.values()];
}

/** First-degree directory neighbours in the 目录 view. */
function crossDirectoryNeighbours(
  graph: Graph,
  directoryIds: Set<string>,
  id: string,
): Set<string> {
  const ids = new Set<string>();
  for (const edge of crossDirectoryEdges(graph, directoryIds)) {
    if (edge.source === id) ids.add(edge.target);
    else if (edge.target === id) ids.add(edge.source);
  }
  return ids;
}

/**
 * One force-simulation step in canvas space. Keeps fixed (saved) nodes pinned.
 * `stress` is the simulation alpha (1 = hot start, → 0 = settled).
 */
function stepSimulation(graph: Graph, width: number, height: number, stress: number): void {
  const nodes = graph.nodes;
  const count = nodes.length;
  if (count === 0 || stress <= 0) return;
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const centerX = w / 2;
  const centerY = h / 2;
  const marginX = Math.min(NODE_MARGIN_MAX, w * 0.04);
  const marginY = Math.min(NODE_MARGIN_MAX, h * 0.04);
  const maxX = Math.max(marginX, w - marginX);
  const maxY = Math.max(marginY, h - marginY);

  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);
  const indexById = new Map<string, number>();
  for (let index = 0; index < count; index += 1) indexById.set(nodes[index].id, index);

  // Weak category gravity: five soft anchors instead of five separate islands.
  const anchorRadius = Math.min(w, h) * 0.16;
  const kindIndex = new Map<NoteKind, number>();
  NOTE_KINDS.forEach((kind, index) => kindIndex.set(kind, index));
  const anchorFor = (kind: NoteKind): { x: number; y: number } => {
    const index = kindIndex.get(kind) ?? 0;
    const angle = -Math.PI / 2 + (index / NOTE_KINDS.length) * Math.PI * 2;
    return {
      x: centerX + Math.cos(angle) * anchorRadius,
      y: centerY + Math.sin(angle) * anchorRadius,
    };
  };

  // Directory branches: each hub is anchored on its own spot of a quiet ring so
  // N directories produce N visibly separate clusters instead of one blob.
  const directoryList: GraphNode[] = nodes
    .filter((node) => node.directory)
    .sort((a, b) => a.id.localeCompare(b.id));
  const directoryById = new Map<string, GraphNode>();
  const directoryAnchor = new Map<string, { x: number; y: number }>();
  const directoryRing = Math.max(24, Math.min(w, h) * 0.28);
  directoryList.forEach((node, index) => {
    directoryById.set(node.id, node);
    if (directoryList.length === 1) {
      directoryAnchor.set(node.id, { x: centerX, y: centerY });
      return;
    }
    const angle = -Math.PI / 2 + (index / directoryList.length) * Math.PI * 2;
    directoryAnchor.set(node.id, {
      x: centerX + Math.cos(angle) * directoryRing,
      y: centerY + Math.sin(angle) * directoryRing,
    });
  });

  // Pairwise repulsion (charge).
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      let dx = nodes[i].x - nodes[j].x;
      let dy = nodes[i].y - nodes[j].y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 1) {
        const angle = (i * 2.399963 + j * 1.3247) % (Math.PI * 2);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distanceSq = 1;
      }
      const distance = Math.sqrt(distanceSq);
      const hubMass = nodes[i].directory || nodes[j].directory ? FORCE.hubRepulsionBoost : 1;
      const force = (FORCE.repulsion * hubMass * stress) / distanceSq;
      const ux = dx / distance;
      const uy = dy / distance;
      forceX[i] += ux * force;
      forceY[i] += uy * force;
      forceX[j] -= ux * force;
      forceY[j] -= uy * force;
    }
  }

  // Link springs along every edge type.
  for (const edge of graph.edges) {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const dx = nodes[targetIndex].x - nodes[sourceIndex].x;
    const dy = nodes[targetIndex].y - nodes[sourceIndex].y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const rest = edge.type === 'directory' ? FORCE.directoryLinkDistance : FORCE.linkDistance;
    const strength =
      edge.type === 'directory' ? FORCE.directoryLinkStrength : FORCE.linkStrength;
    const force = (distance - rest) * strength * stress;
    const ux = dx / distance;
    const uy = dy / distance;
    forceX[sourceIndex] += ux * force;
    forceY[sourceIndex] += uy * force;
    forceX[targetIndex] -= ux * force;
    forceY[targetIndex] -= uy * force;
  }

  // Weak centering + category clustering; directories take over the structure.
  for (let i = 0; i < count; i += 1) {
    const node = nodes[i];
    if (node.directory) {
      // Hubs hold their ring spot so the branches stay readable.
      const anchor = directoryAnchor.get(node.id);
      if (anchor) {
        forceX[i] += (anchor.x - node.x) * FORCE.directoryAnchorStrength * stress;
        forceY[i] += (anchor.y - node.y) * FORCE.directoryAnchorStrength * stress;
      }
      forceX[i] += (centerX - node.x) * FORCE.directoryCenterStrength * stress;
      forceY[i] += (centerY - node.y) * FORCE.directoryCenterStrength * stress;
      continue;
    }
    const directory = node.dirId ? directoryById.get(node.dirId) : undefined;
    if (directory) {
      // Members orbit their directory hub (weak per-directory clustering).
      forceX[i] += (directory.x - node.x) * FORCE.memberAttraction * stress;
      forceY[i] += (directory.y - node.y) * FORCE.memberAttraction * stress;
      const kindAnchor = anchorFor(node.kind);
      forceX[i] += (kindAnchor.x - node.x) * FORCE.memberKindNudge * stress;
      forceY[i] += (kindAnchor.y - node.y) * FORCE.memberKindNudge * stress;
    } else {
      const anchor = anchorFor(node.kind);
      forceX[i] += (anchor.x - node.x) * FORCE.clusterStrength * stress;
      forceY[i] += (anchor.y - node.y) * FORCE.clusterStrength * stress;
    }
    forceX[i] += (centerX - node.x) * FORCE.centerStrength * stress;
    forceY[i] += (centerY - node.y) * FORCE.centerStrength * stress;
  }

  // Integrate with velocity decay, speed clamp and soft canvas bounds.
  for (let i = 0; i < count; i += 1) {
    const node = nodes[i];
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    let vx = (node.vx + forceX[i]) * FORCE.velocityDecay;
    let vy = (node.vy + forceY[i]) * FORCE.velocityDecay;
    if (!Number.isFinite(vx)) vx = 0;
    if (!Number.isFinite(vy)) vy = 0;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > FORCE.maxSpeed) {
      vx = (vx / speed) * FORCE.maxSpeed;
      vy = (vy / speed) * FORCE.maxSpeed;
    }
    let x = node.x + vx;
    let y = node.y + vy;
    if (!Number.isFinite(x)) x = centerX;
    if (!Number.isFinite(y)) y = centerY;
    if (x < marginX) {
      x = marginX;
      vx = 0;
    } else if (x > maxX) {
      x = maxX;
      vx = 0;
    }
    if (y < marginY) {
      y = marginY;
      vy = 0;
    } else if (y > maxY) {
      y = maxY;
      vy = 0;
    }
    node.x = x;
    node.y = y;
    node.vx = vx;
    node.vy = vy;
  }

  // Collision pass: nodes keep a finger-sized gap, saved nodes stay put.
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.fixed && b.fixed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minDistance = nodeRadius(a) + nodeRadius(b) + FORCE.collisionPadding;
      if (distance >= minDistance) continue;
      const overlap = (minDistance - distance) * 0.5;
      const ux = dx / distance;
      const uy = dy / distance;
      if (!a.fixed && !b.fixed) {
        a.x -= ux * overlap;
        a.y -= uy * overlap;
        b.x += ux * overlap;
        b.y += uy * overlap;
      } else if (!a.fixed) {
        a.x -= ux * overlap * 2;
        a.y -= uy * overlap * 2;
      } else {
        b.x += ux * overlap * 2;
        b.y += uy * overlap * 2;
      }
      if (!a.fixed) {
        a.x = clamp(a.x, marginX, maxX);
        a.y = clamp(a.y, marginY, maxY);
      }
      if (!b.fixed) {
        b.x = clamp(b.x, marginX, maxX);
        b.y = clamp(b.y, marginY, maxY);
      }
    }
  }
}

/** Run the force simulation synchronously (reduced motion / initial fallback). */
function settleSimulation(graph: Graph, width: number, height: number, steps: number): void {
  for (let step = 0; step < steps; step += 1) {
    const stress = Math.max(0.05, 1 - step / Math.max(1, steps));
    stepSimulation(graph, width, height, stress);
  }
}

export function GraphView({
  notes,
  activeNoteId = null,
  selectedNoteId = null,
  onSelectNote,
  onOpenNote,
  onMoveNote,
  onCreateNoteAt,
  onLinkNotes,
  onRequestResetLayout,
  onDeleteNote,
  fullscreen = false,
  onToggleFullscreen,
  onOpenDirectory,
  directoriesOnly = false,
  onCreateDirectory,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const graphRef = useRef<Graph | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const viewRef = useRef<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const dprRef = useRef<number>(1);
  const paletteRef = useRef<Palette | null>(null);
  const paletteThemeRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const alphaRef = useRef<number>(0);
  const resizeTimerRef = useRef<number | null>(null);
  const pendingReseedRef = useRef<boolean>(false);
  /** False until the current graph has real (seeded) coordinates. */
  const layoutReadyRef = useRef<boolean>(false);
  const pointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const reducedMotionRef = useRef<boolean>(false);
  /** Keep the camera fitted to the graph while the simulation settles. */
  const autoFitRef = useRef<boolean>(true);

  const [mode, setMode] = useState<GraphMode>('idle');
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState<boolean>(false);
  const [hasGhost, setHasGhost] = useState<boolean>(false);
  /** 记录 (all notes) vs 目录 (directories + cross-directory relations only). */
  const [dirView, setDirView] = useState<'all' | 'directories'>(directoriesOnly ? 'directories' : 'all');

  // Latest props kept in refs so the canvas loop always sees fresh values
  // without being torn down and rebuilt on every React render.
  const activeIdRef = useRef<string | null>(activeNoteId);
  const selectedIdRef = useRef<string | null>(selectedNoteId);
  const modeRef = useRef<GraphMode>(mode);
  const connectSourceRef = useRef<string | null>(connectSource);
  const dirViewRef = useRef<'all' | 'directories'>(dirView);
  const onSelectRef = useRef(onSelectNote);
  const onOpenRef = useRef(onOpenNote);
  const onMoveRef = useRef(onMoveNote);
  const onCreateAtRef = useRef(onCreateNoteAt);
  const onLinkRef = useRef(onLinkNotes);
  const onResetRef = useRef(onRequestResetLayout);
  const onDeleteRef = useRef(onDeleteNote);
  const onOpenDirectoryRef = useRef(onOpenDirectory);
  activeIdRef.current = activeNoteId;
  selectedIdRef.current = selectedNoteId;
  modeRef.current = mode;
  connectSourceRef.current = connectSource;
  dirViewRef.current = dirView;
  onSelectRef.current = onSelectNote;
  onOpenRef.current = onOpenNote;
  onMoveRef.current = onMoveNote;
  onCreateAtRef.current = onCreateNoteAt;
  onLinkRef.current = onLinkNotes;
  onResetRef.current = onRequestResetLayout;
  onDeleteRef.current = onDeleteNote;
  onOpenDirectoryRef.current = onOpenDirectory;

  /** Read theme-aware canvas tokens (cached per app theme). */
  function getPalette(): Palette {
    const container = containerRef.current;
    const theme =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const cached = paletteRef.current;
    if (cached && paletteThemeRef.current === theme) return cached;
    if (!container) return FALLBACK_PALETTE;
    const styles = getComputedStyle(container);
    const read = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    const kindColors = {} as Record<NoteKind, string>;
    for (const kind of NOTE_KINDS) {
      kindColors[kind] = read(KIND_COLOR_VARS[kind], FALLBACK_KIND_COLORS[kind]);
    }
    const palette: Palette = {
      panel: read('--bg', FALLBACK_PALETTE.panel),
      surface: read('--surface', FALLBACK_PALETTE.surface),
      border: read('--border', FALLBACK_PALETTE.border),
      edge: read('--graph-edge', FALLBACK_PALETTE.edge),
      ghost: read('--graph-node-ghost', FALLBACK_PALETTE.ghost),
      accent: read('--accent', FALLBACK_PALETTE.accent),
      text: read('--text', FALLBACK_PALETTE.text),
      textMuted: read('--text-muted', FALLBACK_PALETTE.textMuted),
      fontSans: read('--font-sans', FALLBACK_PALETTE.fontSans),
      kindColors,
    };
    paletteRef.current = palette;
    paletteThemeRef.current = theme;
    return palette;
  }

  /**
   * Match the canvas backing store to the CSS box × DPR.
   * Returns true when the CSS size or devicePixelRatio changed (canvas reset).
   */
  function syncCanvasSize(): boolean {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return false;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    const changed =
      width !== sizeRef.current.width ||
      height !== sizeRef.current.height ||
      dpr !== dprRef.current;
    sizeRef.current = { width, height };
    dprRef.current = dpr;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    return changed;
  }

  function cancelAnimation(): void {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const view = viewRef.current;
    return { x: (screenX - view.tx) / view.scale, y: (screenY - view.ty) / view.scale };
  }

  /** Normalised (0..1) canvas position for a world point. */
  function worldToNormalized(worldX: number, worldY: number): NotePosition {
    const { width, height } = sizeRef.current;
    return {
      x: clamp(worldX / Math.max(1, width), 0, 1),
      y: clamp(worldY / Math.max(1, height), 0, 1),
    };
  }

  function positionFromNode(node: GraphNode): NotePosition {
    return worldToNormalized(node.x, node.y);
  }

  /** One warm category node; selected gets a subtle ring, active a dashed ring. */
  function drawNode(
    context: CanvasRenderingContext2D,
    palette: Palette,
    node: GraphNode,
    scale: number,
    selected: boolean,
    active: boolean,
    hovered: boolean,
    directoryColors: Map<string, string>,
  ): void {
    const radius = nodeRadius(node);

    if (node.ghost) {
      context.beginPath();
      context.arc(node.x, node.y, Math.max(3.5, radius * 0.82), 0, Math.PI * 2);
      context.setLineDash([2.6 / scale, 2.6 / scale]);
      context.lineWidth = 1.2 / scale;
      context.strokeStyle = colorToRgba(palette.textMuted, 0.5);
      context.stroke();
      context.setLineDash([]);
      return;
    }

    // Members inherit their directory colour; unassigned notes keep kind colour.
    const color =
      (node.directory ? directoryColors.get(node.id) : undefined) ??
      (node.dirId ? directoryColors.get(node.dirId) : undefined) ??
      palette.kindColors[node.kind] ??
      palette.textMuted;

    if (node.directory) {
      // Quiet coloured halo: a directory hub reads as a branch, never neon.
      context.beginPath();
      context.arc(node.x, node.y, radius + 4 / scale, 0, Math.PI * 2);
      context.lineWidth = 1.4 / scale;
      context.strokeStyle = colorToRgba(color, 0.38);
      context.stroke();
    }

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = (node.directory ? 1.4 : 1) / scale;
    context.strokeStyle = node.directory
      ? colorToRgba(palette.panel, 0.72)
      : colorToRgba(palette.text, 0.14);
    context.stroke();

    if (selected) {
      context.beginPath();
      context.arc(node.x, node.y, radius + (node.directory ? 5 : 3) / scale, 0, Math.PI * 2);
      context.lineWidth = 1.5 / scale;
      context.strokeStyle = colorToRgba(palette.accent, 0.9);
      context.stroke();
    } else if (hovered) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 2.5 / scale, 0, Math.PI * 2);
      context.lineWidth = 1 / scale;
      context.strokeStyle = colorToRgba(palette.textMuted, 0.45);
      context.stroke();
    }

    if (active) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 5 / scale, 0, Math.PI * 2);
      context.setLineDash([3 / scale, 3 / scale]);
      context.lineWidth = 1.2 / scale;
      context.strokeStyle = colorToRgba(palette.accent, 0.55);
      context.stroke();
      context.setLineDash([]);
    }
  }

  function draw(): void {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const graph = graphRef.current;
    if (!canvas || !container || !graph) return;
    const { width, height } = sizeRef.current;
    if (width < 2 || height < 2) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = dprRef.current;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const palette = getPalette();
    const view = viewRef.current;
    const activeId = activeIdRef.current;
    const selectedId = selectedIdRef.current;
    const hoveredId = hoveredIdRef.current;
    const pendingSource = modeRef.current === 'connect' ? connectSourceRef.current : null;
    const directoryView = dirViewRef.current === 'directories';
    const directories = directoryNodes(graph);
    const directoryIds = new Set(directories.map((node) => node.id));
    const directoryColors = directoryColorMap(graph);
    const visibleNodes = directoryView ? directories : graph.nodes;
    const visibleIds = new Set(visibleNodes.map((node) => node.id));

    const nodeById = new Map<string, GraphNode>();
    for (const node of graph.nodes) nodeById.set(node.id, node);

    const focusCandidate = hoveredId ?? selectedId;
    const focusId =
      focusCandidate !== null && visibleIds.has(focusCandidate) ? focusCandidate : null;
    const dimOthers = hoveredId !== null && visibleIds.has(hoveredId);
    const focusNodes = new Set<string>();
    if (focusId) {
      focusNodes.add(focusId);
      const neighbours = directoryView
        ? crossDirectoryNeighbours(graph, directoryIds, focusId)
        : neighbourIds(graph, focusId);
      for (const id of neighbours) focusNodes.add(id);
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    if (graph.nodes.length === 0) return;
    if (!layoutReadyRef.current) return;

    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // ---- edges ----
    if (directoryView) {
      // 目录 view: only cross-directory relations, weighted by how many member
      // links connect the two directories.
      for (const edge of crossDirectoryEdges(graph, directoryIds)) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        const incident = focusId !== null && (edge.source === focusId || edge.target === focusId);
        const dimmed = dimOthers && !incident;
        context.globalAlpha = dimmed ? 0.16 : incident ? 0.85 : 0.5;
        context.strokeStyle = incident ? palette.accent : palette.edge;
        context.lineWidth =
          (incident ? 1.8 : 1.2 + Math.min(0.6, (edge.weight - 1) * 0.25)) / view.scale;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }

      // The whole network is a person: a quiet centre node ties the directory
      // balls together. It is decorative, not a selectable note.
      if (directories.length >= 2) {
        let cx = 0;
        let cy = 0;
        for (const node of directories) {
          cx += node.x;
          cy += node.y;
        }
        cx /= directories.length;
        cy /= directories.length;
        // Slightly stronger + thicker spokes so the person-level network reads
        // as one connected map at a glance.
        context.globalAlpha = 0.5;
        context.strokeStyle = palette.textMuted;
        context.lineWidth = 4.2 / view.scale;
        context.setLineDash([6 / view.scale, 4 / view.scale]);
        for (const node of directories) {
          context.beginPath();
          context.moveTo(cx, cy);
          context.lineTo(node.x, node.y);
          context.stroke();
        }
        context.setLineDash([]);
        context.globalAlpha = 0.9;
        context.beginPath();
        context.arc(cx, cy, 11, 0, Math.PI * 2);
        context.fillStyle = palette.surface;
        context.fill();
        context.strokeStyle = palette.accent;
        context.lineWidth = 2.2 / view.scale;
        context.stroke();
        context.beginPath();
        context.arc(cx, cy, 4, 0, Math.PI * 2);
        context.fillStyle = palette.accent;
        context.fill();
        context.globalAlpha = 0.75;
        context.fillStyle = palette.textMuted;
        context.font = `${11 / view.scale}px ${palette.fontSans}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('你', cx, cy + 24);
        context.globalAlpha = 1;
      }
    } else {
      // Directory threads sit under the regular links, tinted by their branch.
      for (const edge of graph.edges) {
        if (edge.type !== 'directory') continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        const color = directoryColors.get(edge.target) ?? palette.edge;
        const incident = focusId !== null && (edge.source === focusId || edge.target === focusId);
        const dimmed = dimOthers && !incident;
        context.globalAlpha = dimmed ? 0.14 : incident ? 0.78 : 0.42;
        context.strokeStyle = incident ? palette.accent : color;
        context.lineWidth = (incident ? 1.5 : 1.1) / view.scale;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
      // Regular wiki/manual/day threads: thin warm lines, first-degree focused.
      for (const edge of graph.edges) {
        if (edge.type === 'directory') continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        const incident = focusId !== null && (edge.source === focusId || edge.target === focusId);
        const dimmed = dimOthers && !incident;
        let alpha: number;
        let stroke: string;
        if (dimmed) {
          alpha = 0.12;
          stroke = palette.edge;
        } else if (incident) {
          alpha = 0.7;
          stroke = palette.accent;
        } else if (edge.type === 'manual') {
          alpha = 0.8;
          stroke = palette.edge;
        } else if (edge.type === 'day') {
          alpha = 0.3;
          stroke = palette.edge;
        } else {
          alpha = 0.55;
          stroke = palette.edge;
        }
        context.globalAlpha = alpha;
        context.strokeStyle = stroke;
        context.lineWidth = (incident ? 1.4 : 1) / view.scale;
        if (edge.type === 'day' && !incident) {
          context.setLineDash([2.6 / view.scale, 3.4 / view.scale]);
        } else {
          context.setLineDash([]);
        }
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.setLineDash([]);

    // ---- nodes: ghosts first, regular notes, and directory hubs on top ----
    const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
    const activeNode = activeId ? nodeById.get(activeId) : undefined;
    const orderedNodes = [...visibleNodes].sort((a, b) => {
      if (a.ghost !== b.ghost) return a.ghost ? -1 : 1;
      if (Boolean(a.directory) !== Boolean(b.directory)) return a.directory ? 1 : -1;
      return a.degree - b.degree;
    });
    const drawOne = (node: GraphNode, alpha: number): void => {
      context.globalAlpha = alpha;
      drawNode(
        context,
        palette,
        node,
        view.scale,
        node.id === selectedId,
        node.id === activeId,
        node.id === hoveredId,
        directoryColors,
      );
    };
    for (const node of orderedNodes) {
      if (node.id === selectedId || node.id === activeId) continue;
      const inFocus = focusId === null || focusNodes.has(node.id);
      const dimmed = dimOthers && !inFocus;
      drawOne(node, dimmed ? 0.2 : 1);
    }
    if (pendingSource && visibleIds.has(pendingSource)) {
      const sourceNode = nodeById.get(pendingSource);
      if (sourceNode && !sourceNode.ghost) {
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(
          sourceNode.x,
          sourceNode.y,
          nodeRadius(sourceNode) + 6 / view.scale,
          0,
          Math.PI * 2,
        );
        context.setLineDash([3 / view.scale, 2.6 / view.scale]);
        context.lineWidth = 1.5 / view.scale;
        context.strokeStyle = colorToRgba(palette.accent, 0.95);
        context.stroke();
        context.setLineDash([]);
      }
    }
    if (selectedNode && !selectedNode.ghost && visibleIds.has(selectedNode.id)) {
      const dimmed = dimOthers && !focusNodes.has(selectedNode.id);
      drawOne(selectedNode, dimmed ? 0.35 : 1);
    }
    if (activeNode && !activeNode.ghost && visibleIds.has(activeNode.id)) {
      drawOne(activeNode, 1);
    }
    context.globalAlpha = 1;

    // ---- labels: directory names always; important notes; focus first-degree ----
    if (view.scale < LABEL_MIN_SCALE) return;

    const important = importantNodeIds(graph);
    const labelIds = new Set<string>();
    const labelNeighbours = (id: string): Set<string> =>
      directoryView
        ? crossDirectoryNeighbours(graph, directoryIds, id)
        : neighbourIds(graph, id);
    if (hoveredId !== null && visibleIds.has(hoveredId)) {
      labelIds.add(hoveredId);
      for (const id of labelNeighbours(hoveredId)) if (visibleIds.has(id)) labelIds.add(id);
    } else if (selectedId !== null && visibleIds.has(selectedId)) {
      for (const id of important) if (visibleIds.has(id)) labelIds.add(id);
      labelIds.add(selectedId);
      for (const id of labelNeighbours(selectedId)) if (visibleIds.has(id)) labelIds.add(id);
    } else {
      for (const id of important) if (visibleIds.has(id)) labelIds.add(id);
    }
    // Directory hubs are always labelled.
    for (const node of directories) labelIds.add(node.id);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const priority = visibleNodes
      .filter((node) => labelIds.has(node.id))
      .sort((a, b) => {
        const focusA = a.id === focusId ? 1 : 0;
        const focusB = b.id === focusId ? 1 : 0;
        if (focusA !== focusB) return focusB - focusA;
        if (Boolean(a.directory) !== Boolean(b.directory)) return a.directory ? -1 : 1;
        return b.degree - a.degree || a.title.localeCompare(b.title);
      });
    const takenLabelAreas: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const node of priority) {
      const isDirectoryNode = Boolean(node.directory);
      const isFocused = node.id === hoveredId || node.id === selectedId;
      const label = truncateLabel(node.title, isDirectoryNode ? 18 : MAX_LABEL_CHARS);
      if (!label) continue;
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      if (screenX < -140 || screenX > width + 140 || screenY < -30 || screenY > height + 30) {
        continue;
      }
      context.font = isDirectoryNode || isFocused
        ? `600 ${FOCUS_LABEL_FONT_SIZE}px ${palette.fontSans}`
        : `400 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
      const textWidth = context.measureText(label).width;
      if (textWidth > width - 12) continue;
      const radius = nodeRadius(node) * view.scale;
      const labelX = clamp(screenX, textWidth / 2 + 4, width - textWidth / 2 - 4);
      let labelY = screenY + radius + 9;
      if (labelY + 7 > height - 4) labelY = screenY - radius - 9;
      labelY = clamp(labelY, 8, Math.max(8, height - 8));
      const area = {
        left: labelX - textWidth / 2 - 2,
        right: labelX + textWidth / 2 + 2,
        top: labelY - 8,
        bottom: labelY + 8,
      };
      if (!isFocused && !isDirectoryNode) {
        const overlaps = takenLabelAreas.some(
          (other) =>
            area.left < other.right + 2 &&
            area.right > other.left - 2 &&
            area.top < other.bottom + 2 &&
            area.bottom > other.top - 2,
        );
        if (overlaps) continue;
      }
      takenLabelAreas.push(area);

      // Faint canvas-coloured halo keeps labels legible over edges.
      context.lineWidth = 3;
      context.strokeStyle = colorToRgba(palette.panel, 0.85);
      context.strokeText(label, labelX, labelY);
      context.fillStyle = isDirectoryNode || isFocused
        ? palette.text
        : node.ghost
          ? colorToRgba(palette.textMuted, 0.55)
          : colorToRgba(palette.textMuted, 0.9);
      context.fillText(label, labelX, labelY);
    }
  }

  /**
   * Canvas-local rectangle the graph content must stay inside. Floating title,
   * toolbars, mode hint, legend, zoom controls and the inspector are excluded so
   * no node/label hides beneath the chrome.
   */
  function getSafeRect(width: number, height: number): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const base = 10;
    let left = base;
    let top = base;
    let right = width - base;
    let bottom = height - base;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container && canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      const gap = 12;
      const reserve = (selector: string, side: 'top' | 'right' | 'bottom'): void => {
        const element = container.querySelector(selector);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        if (side === 'right') right = Math.min(right, rect.left - canvasRect.left - gap);
        else if (side === 'bottom') bottom = Math.min(bottom, rect.top - canvasRect.top - gap);
        else top = Math.max(top, rect.bottom - canvasRect.top + gap);
      };
      reserve('.graph-floating-title', 'top');
      reserve('.graph-toolbar', 'top');
      reserve('.graph-view-toggle', 'top');
      reserve('.graph-hint', 'top');
      reserve('.graph-legend-wrap', 'bottom');
      reserve('.graph-view-controls', 'bottom');
      reserve('.graph-inspector', 'bottom');
    }
    if (right - left < 80) {
      left = base;
      right = width - base;
    }
    if (bottom - top < 120) {
      top = base;
      bottom = height - base;
    }
    return { left, top, right, bottom };
  }

  /** Union of visible node dots and their labels, in screen space. */
  function measureFitContent(
    scale: number,
    tx: number,
    ty: number,
  ): { left: number; top: number; right: number; bottom: number } {
    const graph = graphRef.current;
    if (!graph) return { left: 0, top: 0, right: 1, bottom: 1 };
    const selectedId = selectedIdRef.current;
    const directoryView = dirViewRef.current === 'directories';
    const directories = directoryNodes(graph);
    const visibleNodes = directoryView ? directories : graph.nodes;
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const include = (l: number, t: number, r: number, b: number): void => {
      if (l < left) left = l;
      if (t < top) top = t;
      if (r > right) right = r;
      if (b > bottom) bottom = b;
    };

    for (const node of visibleNodes) {
      const radius = nodeRadius(node) * scale;
      const padding =
        node.id === selectedId
          ? 14
          : node.id === activeIdRef.current
            ? 12
            : node.directory
              ? 10
              : node.ghost
                ? 8
                : 5;
      const screenX = node.x * scale + tx;
      const screenY = node.y * scale + ty;
      include(
        screenX - radius - padding,
        screenY - radius - padding,
        screenX + radius + padding,
        screenY + radius + padding,
      );
    }

    const context = canvasRef.current?.getContext('2d');
    if (context) {
      const palette = getPalette();
      const canvasWidth = sizeRef.current.width;
      const labelIds = new Set<string>();
      for (const id of importantNodeIds(graph)) if (visibleIds.has(id)) labelIds.add(id);
      if (selectedId && visibleIds.has(selectedId)) labelIds.add(selectedId);
      for (const node of directories) labelIds.add(node.id);
      for (const node of visibleNodes) {
        if (!labelIds.has(node.id)) continue;
        const isDirectoryNode = Boolean(node.directory);
        const focused = node.id === selectedId;
        const label = truncateLabel(node.title, isDirectoryNode ? 18 : MAX_LABEL_CHARS);
        if (!label) continue;
        context.font = isDirectoryNode || focused
          ? `600 ${FOCUS_LABEL_FONT_SIZE}px ${palette.fontSans}`
          : `400 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
        const labelWidth = Math.min(context.measureText(label).width + 4, canvasWidth - 12);
        const radius = nodeRadius(node) * scale;
        const screenX = node.x * scale + tx;
        const screenY = node.y * scale + ty;
        const labelTop = screenY + radius + 8;
        include(screenX - labelWidth / 2, labelTop, screenX + labelWidth / 2, labelTop + 16);
      }
    }

    return { left, top, right, bottom };
  }

  /** Camera that fits every visible node and label inside the safe rect. */
  function computeFitView(): Viewport {
    const graph = graphRef.current;
    const { width, height } = sizeRef.current;
    if (!graph || width < 2 || height < 2) {
      return { scale: 1, tx: 0, ty: 0 };
    }
    const directoryView = dirViewRef.current === 'directories';
    const directories = directoryNodes(graph);
    const visibleNodes = directoryView ? directories : graph.nodes;
    if (visibleNodes.length === 0) return { scale: 1, tx: 0, ty: 0 };

    const safe = getSafeRect(width, height);
    const availableWidth = Math.max(40, safe.right - safe.left - 8);
    const availableHeight = Math.max(40, safe.bottom - safe.top - 8);
    const targetX = (safe.left + safe.right) / 2;
    const targetY = (safe.top + safe.bottom) / 2;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of visibleNodes) {
      const radius =
        nodeRadius(node) +
        (node.id === selectedIdRef.current ? 14 : node.directory ? 10 : 5);
      minX = Math.min(minX, node.x - radius);
      minY = Math.min(minY, node.y - radius);
      maxX = Math.max(maxX, node.x + radius);
      maxY = Math.max(maxY, node.y + radius);
    }
    const nodeWidth = Math.max(1, maxX - minX);
    const nodeHeight = Math.max(1, maxY - minY);
    let scale = clamp(
      Math.min(availableWidth / nodeWidth, availableHeight / nodeHeight),
      MIN_SCALE,
      1.6,
    );
    let tx = targetX - ((minX + maxX) / 2) * scale;
    let ty = targetY - ((minY + maxY) / 2) * scale;

    for (let pass = 0; pass < 5; pass += 1) {
      const content = measureFitContent(scale, tx, ty);
      tx += targetX - (content.left + content.right) / 2;
      ty += targetY - (content.top + content.bottom) / 2;
      const usedWidth = Math.max(1, content.right - content.left);
      const usedHeight = Math.max(1, content.bottom - content.top);
      const overflow = Math.min(1, availableWidth / usedWidth, availableHeight / usedHeight);
      if (overflow > 0.995) break;
      const nextScale = clamp(scale * overflow * 0.995, MIN_SCALE, 1.6);
      if (Math.abs(nextScale - scale) < 0.0005) break;
      tx = targetX - ((targetX - tx) / scale) * nextScale;
      ty = targetY - ((targetY - ty) / scale) * nextScale;
      scale = nextScale;
    }

    const finalContent = measureFitContent(scale, tx, ty);
    if (finalContent.right > safe.right - 4) tx -= finalContent.right - (safe.right - 4);
    if (finalContent.left < safe.left + 4) tx += safe.left + 4 - finalContent.left;
    if (finalContent.bottom > safe.bottom - 4) ty -= finalContent.bottom - (safe.bottom - 4);
    if (finalContent.top < safe.top + 4) ty += safe.top + 4 - finalContent.top;

    return { scale, tx, ty };
  }

  function fitView(): void {
    viewRef.current = computeFitView();
  }

  /** Ease the camera toward the current graph bounds while it settles. */
  function followView(): void {
    const target = computeFitView();
    const view = viewRef.current;
    const rate = 0.18;
    viewRef.current = {
      scale: view.scale + (target.scale - view.scale) * rate,
      tx: view.tx + (target.tx - view.tx) * rate,
      ty: view.ty + (target.ty - view.ty) * rate,
    };
  }

  /** One animation frame of the force simulation; stops when alpha decays. */
  function simulationFrame(): void {
    rafRef.current = null;
    const graph = graphRef.current;
    if (!graph) return;
    const { width, height } = sizeRef.current;
    if (width < 2 || height < 2) return;
    let alpha = alphaRef.current;
    if (alpha <= FORCE.alphaMin) {
      alphaRef.current = 0;
      if (autoFitRef.current) fitView();
      draw();
      return;
    }
    stepSimulation(graph, width, height, alpha);
    alpha *= FORCE.alphaDecay;
    alphaRef.current = alpha;
    if (autoFitRef.current) followView();
    draw();
    if (alpha > FORCE.alphaMin) {
      rafRef.current = requestAnimationFrame(simulationFrame);
    } else if (autoFitRef.current) {
      fitView();
      draw();
    }
  }

  /** Nudge the simulation awake (drag, release, add). */
  function reheat(alpha: number): void {
    const graph = graphRef.current;
    if (!graph) return;
    if (reducedMotionRef.current) {
      const { width, height } = sizeRef.current;
      settleSimulation(graph, width, height, 20);
      draw();
      return;
    }
    alphaRef.current = Math.max(alphaRef.current, alpha);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(simulationFrame);
    }
  }

  /** Map saved positions onto the current canvas (used when preserving). */
  function placeSavedNodes(graph: Graph, width: number, height: number): void {
    const marginX = Math.min(NODE_MARGIN_MAX, width * 0.04);
    const marginY = Math.min(NODE_MARGIN_MAX, height * 0.04);
    for (const node of graph.nodes) {
      if (!node.position) continue;
      node.fixed = true;
      node.x = clamp(node.position.x * width, marginX, Math.max(marginX, width - marginX));
      node.y = clamp(node.position.y * height, marginY, Math.max(marginY, height - marginY));
      node.vx = 0;
      node.vy = 0;
    }
  }

  /**
   * (Re)start the simulation.
   * `reseed = true` rebuilds the deterministic seed + hot simulation (initial,
   * resize, reset). `reseed = false` keeps settled coordinates for edits and
   * only reheats when a brand-new free node appears.
   */
  function startLayout(reseed: boolean, addedFree = false): void {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
    cancelAnimation();
    const graph = graphRef.current;
    if (!graph) return;
    const { width, height } = sizeRef.current;
    if (graph.nodes.length === 0) {
      layoutReadyRef.current = true;
      alphaRef.current = 0;
      viewRef.current = { scale: 1, tx: 0, ty: 0 };
      draw();
      return;
    }
    if (width < 2 || height < 2) {
      layoutReadyRef.current = false;
      return;
    }

    if (reseed) {
      seedPositions(graph, width, height);
      for (const node of graph.nodes) {
        node.vx = 0;
        node.vy = 0;
      }
    } else {
      placeSavedNodes(graph, width, height);
    }
    layoutReadyRef.current = true;

    if (reducedMotionRef.current) {
      settleSimulation(graph, width, height, reseed ? 70 : 24);
      if (reseed || autoFitRef.current) fitView();
      alphaRef.current = 0;
      draw();
      return;
    }

    alphaRef.current = reseed ? FORCE.initialAlpha : addedFree ? ADDED_NODE_SETTLE_ALPHA : 0;
    if (reseed && autoFitRef.current) fitView();
    draw();
    if (alphaRef.current > FORCE.alphaMin) {
      rafRef.current = requestAnimationFrame(simulationFrame);
    }
  }

  /** Resize re-layouts are debounced so dragging a window stays calm. */
  function scheduleRelayout(): void {
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      autoFitRef.current = true;
      startLayout(true);
    }, 120);
  }

  function eventPosition(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function zoomAt(px: number, py: number, factor: number): void {
    autoFitRef.current = false;
    const view = viewRef.current;
    const nextScale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
    if (nextScale === view.scale) return;
    const worldX = (px - view.tx) / view.scale;
    const worldY = (py - view.ty) / view.scale;
    viewRef.current = {
      scale: nextScale,
      tx: px - worldX * nextScale,
      ty: py - worldY * nextScale,
    };
    draw();
  }

  function zoomBy(factor: number): void {
    const { width, height } = sizeRef.current;
    zoomAt(width / 2, height / 2, factor);
  }

  function findNodeAt(px: number, py: number): GraphNode | null {
    const graph = graphRef.current;
    if (!graph) return null;
    const view = viewRef.current;
    const directoryView = dirViewRef.current === 'directories';
    const candidates = directoryView ? directoryNodes(graph) : graph.nodes;
    let best: GraphNode | null = null;
    let bestDistance = Infinity;
    for (const node of candidates) {
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      const distance = Math.hypot(px - screenX, py - screenY);
      const hitRadius = Math.max(22, nodeRadius(node) * view.scale + 14);
      if (distance <= hitRadius && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  // ---- hover / tap / selection / linking ----

  function updateHover(screenX: number, screenY: number, pointerType: string): void {
    if (pointerType === 'touch') return;
    const hit = findNodeAt(screenX, screenY);
    const nextId = hit && !hit.ghost ? hit.id : null;
    if (nextId === hoveredIdRef.current) return;
    hoveredIdRef.current = nextId;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = nextId && modeRef.current === 'idle' ? 'pointer' : '';
    draw();
  }

  function clearHover(): void {
    if (hoveredIdRef.current === null) return;
    hoveredIdRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    draw();
  }

  function handleNodeTap(node: GraphNode): void {
    const currentMode = modeRef.current;
    if (node.directory && currentMode === 'connect') {
      // Directories connect through their members, not through hand-drawn links.
      return;
    }
    if (currentMode === 'connect') {
      const source = connectSourceRef.current;
      if (!source) {
        setConnectSource(node.id);
        draw();
        return;
      }
      if (source === node.id) {
        setConnectSource(null);
        draw();
        return;
      }
      const graph = graphRef.current;
      if (graph && graph.nodes.some((item) => item.id === source)) {
        onLinkRef.current(source, node.id);
      }
      setConnectSource(null);
      draw();
      return;
    }

    if (dirViewRef.current === 'directories' && node.directory && onOpenDirectoryRef.current) {
      onOpenDirectoryRef.current(node.id);
      return;
    }

    // Idle / add mode: select (opens the inspector), second tap opens the note.
    const now = performance.now();
    const last = lastTapRef.current;
    if (last && last.id === node.id && now - last.time <= DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      onSelectRef.current(node.id);
      onOpenRef.current?.(node.id);
      draw();
      return;
    }
    lastTapRef.current = { id: node.id, time: now };
    onSelectRef.current(node.id);
    draw();
  }

  function handleBackgroundTap(screenX: number, screenY: number): void {
    const currentMode = modeRef.current;
    if (currentMode === 'add') {
      const world = screenToWorld(screenX, screenY);
      onCreateAtRef.current(worldToNormalized(world.x, world.y));
      setMode('idle');
      lastTapRef.current = null;
      draw();
      return;
    }
    if (currentMode === 'connect') {
      setConnectSource(null);
      draw();
      return;
    }
    lastTapRef.current = null;
    onSelectRef.current(null);
    draw();
  }

  function handleTap(screenX: number, screenY: number): void {
    const node = findNodeAt(screenX, screenY);
    if (node && !node.ghost) {
      handleNodeTap(node);
      return;
    }
    if (node && node.ghost) return;
    handleBackgroundTap(screenX, screenY);
  }

  // ---- pointer / wheel handlers (native so wheel can preventDefault) ----

  function beginPinchIfNeeded(): void {
    const active = [...pointersRef.current.values()];
    if (active.length < 2) return;
    const first = active[0];
    const second = active[1];
    if (!first || !second) return;
    for (const pointer of active) pointer.multi = true;
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2,
      scale: viewRef.current.scale,
      tx: viewRef.current.tx,
      ty: viewRef.current.ty,
    };
  }

  function cancelDrag(revert: boolean): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (revert && drag.moved) {
      const node = graphRef.current?.nodes.find((item) => item.id === drag.nodeId);
      if (node) {
        node.x = drag.originX;
        node.y = drag.originY;
        node.fixed = Boolean(node.position);
        node.vx = 0;
        node.vy = 0;
      }
    }
    dragRef.current = null;
  }

  function commitDragPosition(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    const node = graphRef.current?.nodes.find((item) => item.id === drag.nodeId);
    if (!node) return;
    const position = positionFromNode(node);
    node.position = position;
    node.fixed = true;
    node.vx = 0;
    node.vy = 0;
    onMoveRef.current(node.id, position);
    reheat(FORCE.releaseAlpha);
    draw();
  }

  function handlePointerDown(event: PointerEvent): void {
    const canvas = canvasRef.current;
    const graph = graphRef.current;
    if (!canvas || !graph || graph.nodes.length === 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    hoveredIdRef.current = null;
    if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
    const position = eventPosition(event);
    const world = screenToWorld(position.x, position.y);
    pointersRef.current.set(event.pointerId, {
      x: position.x,
      y: position.y,
      startX: position.x,
      startY: position.y,
      startedAt: performance.now(),
      moved: false,
      multi: false,
    });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }

    if (pointersRef.current.size === 1) {
      const hit = findNodeAt(position.x, position.y);
      if (hit && !hit.ghost) {
        dragRef.current = {
          pointerId: event.pointerId,
          nodeId: hit.id,
          offsetX: hit.x - world.x,
          offsetY: hit.y - world.y,
          originX: hit.x,
          originY: hit.y,
          moved: false,
          startedAt: performance.now(),
        };
      }
    } else if (pointersRef.current.size === 2) {
      cancelDrag(true);
      beginPinchIfNeeded();
    }
    draw();
  }

  function handlePointerMove(event: PointerEvent): void {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) {
      if (pointersRef.current.size === 0) {
        const position = eventPosition(event);
        updateHover(position.x, position.y, event.pointerType);
      }
      return;
    }
    const position = eventPosition(event);
    const dx = position.x - pointer.x;
    const dy = position.y - pointer.y;
    if (Math.hypot(position.x - pointer.startX, position.y - pointer.startY) > TAP_SLOP) {
      pointer.moved = true;
    }
    pointer.x = position.x;
    pointer.y = position.y;

    if (pointersRef.current.size >= 2) {
      const pinch = pinchRef.current;
      if (!pinch) return;
      const active = [...pointersRef.current.values()];
      const first = active[0];
      const second = active[1];
      if (!first || !second) return;
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const nextScale = clamp((pinch.scale * distance) / pinch.distance, MIN_SCALE, MAX_SCALE);
      const worldX = (pinch.midX - pinch.tx) / pinch.scale;
      const worldY = (pinch.midY - pinch.ty) / pinch.scale;
      autoFitRef.current = false;
      viewRef.current = {
        scale: nextScale,
        tx: midX - worldX * nextScale,
        ty: midY - worldY * nextScale,
      };
      draw();
      return;
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (!drag.moved) {
        if (!pointer.moved) return;
        drag.moved = true;
        autoFitRef.current = false;
      }
      const graph = graphRef.current;
      const node = graph?.nodes.find((item) => item.id === drag.nodeId);
      if (!graph || !node) return;
      const world = screenToWorld(position.x, position.y);
      const { width, height } = sizeRef.current;
      const marginX = Math.min(NODE_MARGIN_MAX, width * 0.04);
      const marginY = Math.min(NODE_MARGIN_MAX, height * 0.04);
      node.fixed = true;
      node.x = clamp(world.x + drag.offsetX, marginX, Math.max(marginX, width - marginX));
      node.y = clamp(world.y + drag.offsetY, marginY, Math.max(marginY, height - marginY));
      node.vx = 0;
      node.vy = 0;
      // Let the neighbourhood respond while the node is being dragged.
      reheat(FORCE.dragAlpha);
      draw();
      return;
    }

    if (!pointer.moved) return;
    autoFitRef.current = false;
    const view = viewRef.current;
    viewRef.current = { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy };
    draw();
  }

  function handlePointerUp(event: PointerEvent): void {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointersRef.current.delete(event.pointerId);
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }

    if (pointersRef.current.size === 1) {
      pinchRef.current = null;
      const remaining = [...pointersRef.current.values()][0];
      if (remaining) remaining.moved = true;
      return;
    }
    if (pointersRef.current.size > 0) return;

    pinchRef.current = null;
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (drag.moved) {
        commitDragPosition();
        return;
      }
      dragRef.current = null;
      const node = graphRef.current?.nodes.find((item) => item.id === drag.nodeId);
      const elapsed = performance.now() - drag.startedAt;
      if (node && elapsed <= TAP_TIME) {
        handleNodeTap(node);
        return;
      }
      return;
    }

    const elapsed = performance.now() - pointer.startedAt;
    if (!pointer.moved && !pointer.multi && elapsed <= TAP_TIME) {
      const position = eventPosition(event);
      handleTap(position.x, position.y);
    }
  }

  function handlePointerCancel(event: PointerEvent): void {
    pointersRef.current.delete(event.pointerId);
    if (dragRef.current && dragRef.current.pointerId === event.pointerId) {
      if (dragRef.current.moved) commitDragPosition();
      else dragRef.current = null;
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const remaining = [...pointersRef.current.values()][0];
    if (remaining) remaining.moved = true;
    draw();
  }

  function handlePointerLeave(): void {
    clearHover();
  }

  function handleWheel(event: WheelEvent): void {
    const graph = graphRef.current;
    if (!graph || graph.nodes.length === 0) return;
    event.preventDefault();
    const position = eventPosition(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(position.x, position.y, Math.exp(-delta * 0.0015));
  }

  function handleWindowResize(): void {
    if (!syncCanvasSize()) return;
    draw();
    scheduleRelayout();
  }

  // ---- toolbar actions ----

  function handleResetLayout(): void {
    autoFitRef.current = true;
    pendingReseedRef.current = true;
    setMode('idle');
    setConnectSource(null);
    lastTapRef.current = null;
    hoveredIdRef.current = null;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    const graph = graphRef.current;
    if (graph) {
      for (const node of graph.nodes) {
        node.fixed = false;
        node.position = undefined;
        node.vx = 0;
        node.vy = 0;
      }
    }
    onResetRef.current?.();
    onSelectRef.current?.(null);
    startLayout(true);
  }

  function handleFit(): void {
    autoFitRef.current = true;
    fitView();
    draw();
  }

  function toggleAddMode(): void {
    setMode((current) => (current === 'add' ? 'idle' : 'add'));
    setConnectSource(null);
    lastTapRef.current = null;
    clearHover();
  }

  function toggleConnectMode(): void {
    setMode((current) => (current === 'connect' ? 'idle' : 'connect'));
    setConnectSource(null);
    lastTapRef.current = null;
    clearHover();
  }

  /** 记录/目录 toggle: directory view shows only hubs + cross-directory edges. */
  function setDirectoryView(next: 'all' | 'directories'): void {
    if (dirViewRef.current === next) return;
    dirViewRef.current = next;
    setDirView(next);
    setMode('idle');
    setConnectSource(null);
    lastTapRef.current = null;
    clearHover();
    if (next === 'directories') {
      const selected = selectedIdRef.current;
      const node = selected ? graphRef.current?.nodes.find((item) => item.id === selected) : undefined;
      if (selected && (!node || !node.directory)) onSelectRef.current(null);
    }
    autoFitRef.current = true;
    if (layoutReadyRef.current) fitView();
    draw();
  }

  /** Inspector 编辑: open the note editor through the App callback. */
  function handleEditSelected(id: string): void {
    if (onOpenRef.current) onOpenRef.current(id);
    else onSelectRef.current(id);
  }

  /** Inspector 连线: enter Link mode with this node as the first endpoint. */
  function handleLinkFromSelected(id: string): void {
    setMode('connect');
    setConnectSource(id);
    lastTapRef.current = null;
    clearHover();
    onSelectRef.current(null);
  }

  /** Inspector 删除. */
  function handleDeleteSelected(id: string): void {
    onDeleteRef.current?.(id);
    onSelectRef.current(null);
  }

  // ---- lifecycle: canvas sizing, native listeners, cleanup ----

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = media.matches;
    syncCanvasSize();
    if (graphRef.current) startLayout(false);
    else draw();

    const resizeObserver = new ResizeObserver(() => {
      if (!syncCanvasSize()) return;
      draw();
      scheduleRelayout();
    });
    resizeObserver.observe(container);

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerCancel);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('resize', handleWindowResize);

    const handleMotionChange = (): void => {
      reducedMotionRef.current = media.matches;
      if (media.matches) {
        const graph = graphRef.current;
        const { width, height } = sizeRef.current;
        if (graph) settleSimulation(graph, width, height, 40);
        cancelAnimation();
        alphaRef.current = 0;
        if (autoFitRef.current) fitView();
        draw();
      } else {
        startLayout(false);
      }
    };
    media.addEventListener('change', handleMotionChange);

    // Theme switches only change tokens; redraw instead of rebuilding the graph.
    const themeObserver = new MutationObserver(() => {
      paletteThemeRef.current = '';
      if (autoFitRef.current) fitView();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      cancelAnimation();
      alphaRef.current = 0;
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      resizeObserver.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('resize', handleWindowResize);
      media.removeEventListener('change', handleMotionChange);
      themeObserver.disconnect();
      pointersRef.current.clear();
      pinchRef.current = null;
      dragRef.current = null;
      hoveredIdRef.current = null;
    };
  }, []);

  // Build the graph from notes; keep settled coordinates so small edits don't
  // reshuffle the whole map (positions/kinds/links only re-style or re-pin).
  useEffect(() => {
    const previous = graphRef.current;
    const previousFingerprint = fingerprintRef.current;
    const fingerprint = fingerprintNotes(notes);
    if (fingerprint === previousFingerprint && previous) return;

    const next = buildGraph(notes);
    fingerprintRef.current = fingerprint;
    graphRef.current = next;
    dragRef.current = null;
    lastTapRef.current = null;
    hoveredIdRef.current = null;

    const forceReseed = pendingReseedRef.current;
    pendingReseedRef.current = false;
    const preserve = previous !== null && previousFingerprint !== null && !forceReseed;
    let addedFree = false;
    if (preserve && previous) {
      const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
      const { width, height } = sizeRef.current;
      for (let index = 0; index < next.nodes.length; index += 1) {
        const node = next.nodes[index];
        if (node.position) continue;
        const old = previousById.get(node.id);
        if (old) {
          node.x = old.x;
          node.y = old.y;
          node.fixed = false;
          node.vx = 0;
          node.vy = 0;
        } else {
          addedFree = true;
          if (width > 4 && height > 4) {
            const radius = 40 + Math.sqrt(index + 1) * 18;
            node.x = clamp(
              width / 2 + Math.cos(index * GOLDEN_ANGLE) * radius,
              20,
              Math.max(20, width - 20),
            );
            node.y = clamp(
              height / 2 + Math.sin(index * GOLDEN_ANGLE) * radius,
              20,
              Math.max(20, height - 20),
            );
          }
        }
      }
    }

    const source = connectSourceRef.current;
    if (source && !next.nodes.some((node) => node.id === source)) {
      setConnectSource(null);
    }
    const ghostPresent = next.nodes.some((node) => node.ghost);
    setHasGhost((current) => (current === ghostPresent ? current : ghostPresent));

    startLayout(!preserve, addedFree);
  }, [notes]);

  // Selection changes adjust the camera (inspector reserves space) + redraw.
  useEffect(() => {
    if (autoFitRef.current && layoutReadyRef.current) fitView();
    draw();
  }, [activeNoteId, selectedNoteId]);

  // Mode changes redraw cursors/hints and re-fit for the new hint band so the
  // graph never sits under the Add/Link hint chip.
  useEffect(() => {
    if (autoFitRef.current && layoutReadyRef.current) fitView();
    draw();
  }, [mode, connectSource]);

  // 记录 → 目录 switches to a new visible subset; re-fit + redraw.
  useEffect(() => {
    if (autoFitRef.current && layoutReadyRef.current) fitView();
    draw();
  }, [dirView]);

  const hint =
    mode === 'add'
      ? '添加模式 · 点空白处放一个新点'
      : mode === 'connect'
        ? connectSource
          ? '连线模式 · 再选第二个节点'
          : '连线模式 · 选择第一个节点'
        : dirView === 'directories'
          ? '目录视图 · 点小球打开目录内容'
          : null;

  const directories = directoryList(notes);
  const hasDirectories = directories.length > 0;
  const directoryOnly = dirView === 'directories';
  const activeNotes = notes.filter((note) => !note.archivedAt && !note.meta.plan);
  const visibleNoteCount = activeNotes.filter((note) => !note.meta.directory).length;
  /** Legend kinds are unassigned-only once directories drive the structure. */
  const legendKinds = NOTE_KINDS.filter((kind) =>
    notes.some(
      (note) =>
        !note.archivedAt &&
        !note.meta.plan &&
        !note.meta.directory &&
        !note.dirId &&
        noteKind(note) === kind,
    ),
  );

  // Compact node inspector data (derived from the selected note + graph edges).
  const inspectorNote = selectedNoteId ? notes.find((note) => note.id === selectedNoteId) ?? null : null;
  const inspectorNode = selectedNoteId
    ? graphRef.current?.nodes.find((node) => node.id === selectedNoteId)
    : undefined;
  const inspectorIsDirectory = Boolean(inspectorNode?.directory) || Boolean(inspectorNote && isDirectory(inspectorNote));
  const inspectorDirectoryColor =
    inspectorNode?.dirColor ?? (inspectorNote?.meta.directory?.color || DEFAULT_DIRECTORY_COLOR);
  const directoryMembers =
    inspectorIsDirectory && selectedNoteId
      ? notes
          .filter(
            (note) =>
              note.dirId === selectedNoteId &&
              !note.archivedAt &&
              !note.meta.plan &&
              !isDirectory(note),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
      : [];
  let inspectorContacts: InspectorContact[] = [];
  let inspectorExcerpt = '';
  if (inspectorNote && !inspectorIsDirectory) {
    const graph = graphRef.current;
    const nodeById = new Map<string, GraphNode>();
    if (graph) for (const node of graph.nodes) nodeById.set(node.id, node);
    const titleById = new Map<string, string>();
    for (const note of notes) titleById.set(note.id, note.title);
    if (graph) {
      const seen = new Set<string>();
      for (const edge of graph.edges) {
        if (edge.type === 'directory') continue;
        const outgoing = edge.source === inspectorNote.id;
        const incoming = edge.target === inspectorNote.id;
        if (!outgoing && !incoming) continue;
        const otherId = outgoing ? edge.target : edge.source;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        inspectorContacts.push({
          id: otherId,
          title: titleById.get(otherId) ?? nodeById.get(otherId)?.title ?? '未创建',
          outgoing,
          exists: titleById.has(otherId),
        });
      }
      inspectorContacts.sort((a, b) => {
        if (a.outgoing !== b.outgoing) return a.outgoing ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    }
    inspectorExcerpt = excerptOf(inspectorNote.content);
  }

  return (
    <div
      className={`graph-view${mode === 'add' ? ' is-adding' : ''}${
        mode === 'connect' ? ' is-connecting' : ''
      }${fullscreen ? ' is-fullscreen' : ''}`}
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="img"
        aria-label="生活图谱画布，可拖动平移、双指缩放，拖动节点调整位置"
      />
      {(directoriesOnly ? directories.length > 0 : notes.length > 0) ? (
        <>
          <div className="graph-floating-title">
            <div className="graph-floating-title-row">
              <h2 className="graph-floating-heading">生活图谱</h2>
              {onToggleFullscreen ? (
                <button
                  type="button"
                  className="graph-fullscreen-btn"
                  onClick={onToggleFullscreen}
                  aria-label={fullscreen ? '退出沉浸模式' : '沉浸模式'}
                  aria-pressed={fullscreen}
                  title={fullscreen ? '退出沉浸模式' : '沉浸模式'}
                >
                  <Icon name="eye" size={15} />
                </button>
              ) : null}
            </div>
            <p className="graph-floating-meta">
              {directoryOnly
                ? `${directories.length} 个目录 · 整个网络代表你`
                : `${visibleNoteCount} 条记录${hasDirectories ? ` · ${directories.length} 个目录` : ''}`}
              {mode === 'add' ? ' · 添加模式' : mode === 'connect' ? ' · 连线模式' : ''}
            </p>
          </div>
          {!directoriesOnly && hasDirectories ? (
            <div className="graph-view-toggle" role="group" aria-label="图谱视图">
              <button
                type="button"
                className={`graph-toggle-btn${dirView === 'all' ? ' is-active' : ''}`}
                onClick={() => setDirectoryView('all')}
                aria-label="记录视图"
                aria-pressed={dirView === 'all'}
              >
                记录
              </button>
              <button
                type="button"
                className={`graph-toggle-btn${dirView === 'directories' ? ' is-active' : ''}`}
                onClick={() => setDirectoryView('directories')}
                aria-label="目录视图"
                aria-pressed={dirView === 'directories'}
              >
                目录
              </button>
            </div>
          ) : null}
          {hint ? (
            <div className="graph-hint" role="status">
              {hint}
              {mode === 'connect' ? (
                <span className="graph-hint-steps" aria-hidden="true">
                  <span className={connectSource ? 'is-done' : 'is-current'}>1</span>
                  <span className="graph-hint-arrow">→</span>
                  <span className={connectSource ? 'is-current' : ''}>2</span>
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="graph-toolbar" role="toolbar" aria-label="图谱工具">
            {!directoryOnly ? (
              <>
                <button
                  type="button"
                  className="icon-btn graph-btn"
                  onClick={toggleAddMode}
                  aria-label="添加记录"
                  title="添加记录"
                  aria-pressed={mode === 'add'}
                >
                  <Icon name="plus" size={19} />
                </button>
                <button
                  type="button"
                  className="icon-btn graph-btn"
                  onClick={toggleConnectMode}
                  aria-label="连线"
                  title="连线"
                  aria-pressed={mode === 'connect'}
                >
                  <Icon name="link" size={19} />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={handleResetLayout}
              aria-label="重新布局"
              title="重新布局"
            >
              <Icon name="refresh" size={19} />
            </button>
          </div>
          {!inspectorNote ? (
            <div className="graph-view-controls" role="toolbar" aria-label="图谱视图">
              <button
                type="button"
                className="icon-btn graph-btn graph-btn--floating"
                onClick={() => zoomBy(ZOOM_STEP)}
                aria-label="放大"
                title="放大"
              >
                <Icon name="zoomIn" size={19} />
              </button>
              <button
                type="button"
                className="icon-btn graph-btn graph-btn--floating"
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                aria-label="缩小"
                title="缩小"
              >
                <Icon name="zoomOut" size={19} />
              </button>
              <button
                type="button"
                className="icon-btn graph-btn graph-btn--floating"
                onClick={handleFit}
                aria-label="适应画布"
                title="适应画布"
              >
                <Icon name="fit" size={19} />
              </button>
            </div>
          ) : null}
          {!inspectorNote ? (
            <div className="graph-legend-wrap">
              <button
                type="button"
                className="graph-legend-toggle"
                onClick={() => setLegendOpen((open) => !open)}
                aria-label={legendOpen ? '收起图例' : '展开图例'}
                aria-expanded={legendOpen}
              >
                <Icon name="tag" size={14} />
                <span>图例</span>
              </button>
              {legendOpen ? (
                <div className="graph-legend" aria-label="图例">
                  {hasDirectories
                    ? directories.map((directory) => (
                        <span key={directory.id} className="graph-legend-item">
                          <span
                            className="graph-legend-dot"
                            style={{
                              backgroundColor:
                                directory.meta.directory?.color || DEFAULT_DIRECTORY_COLOR,
                            }}
                            aria-hidden="true"
                          />
                          <span>{truncateLabel(directory.title, 10)}</span>
                        </span>
                      ))
                    : null}
                  {!directoryOnly
                    ? legendKinds.map((kind) => (
                        <span key={kind} className="graph-legend-item">
                          <span
                            className="graph-legend-dot"
                            style={{ backgroundColor: `var(${KIND_COLOR_VARS[kind]})` }}
                            aria-hidden="true"
                          />
                          <span>{KIND_LABELS[kind]}</span>
                        </span>
                      ))
                    : null}
                  {hasGhost && !directoryOnly ? (
                    <span className="graph-legend-item">
                      <span
                        className="graph-legend-dot graph-legend-dot--ghost"
                        aria-hidden="true"
                      />
                      <span>未创建</span>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {inspectorNote ? (
            inspectorIsDirectory ? (
              <section className="graph-inspector graph-inspector--directory" aria-label="目录详情">
                <header className="graph-inspector-head">
                  <span className="graph-inspector-kind">
                    <span
                      className="graph-inspector-dot"
                      style={{ backgroundColor: inspectorDirectoryColor }}
                      aria-hidden="true"
                    />
                    目录
                  </span>
                  <h3 className="graph-inspector-title">{inspectorNote.title}</h3>
                  <button
                    type="button"
                    className="graph-inspector-close"
                    aria-label="关闭节点详情"
                    onClick={() => onSelectNote(null)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </header>
                <p className="graph-inspector-meta">{directoryMembers.length} 条记录</p>
                <div className="graph-inspector-connections">
                  <span className="graph-inspector-label">目录内记录</span>
                  {directoryMembers.length > 0 ? (
                    <div className="graph-inspector-chips">
                      {directoryMembers.slice(0, 6).map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          className="graph-chip"
                          onClick={() => {
                            if (onOpenRef.current) onOpenRef.current(member.id);
                            else onSelectRef.current(member.id);
                          }}
                        >
                          {member.title}
                        </button>
                      ))}
                      {directoryMembers.length > 6 ? (
                        <span className="graph-chip graph-chip--muted">
                          +{directoryMembers.length - 6}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="graph-inspector-muted">这个目录还没有记录</span>
                  )}
                </div>
                {onOpenDirectory ? (
                  <footer className="graph-inspector-actions">
                    <button
                      type="button"
                      className="graph-action"
                      onClick={() => onOpenDirectory(inspectorNote.id)}
                    >
                      打开目录
                    </button>
                  </footer>
                ) : null}
              </section>
            ) : (
              <section className="graph-inspector" aria-label="节点详情">
              <header className="graph-inspector-head">
                <span className="graph-inspector-kind">
                  <span
                    className="graph-inspector-dot"
                    style={{ backgroundColor: `var(${KIND_COLOR_VARS[noteKind(inspectorNote)]})` }}
                    aria-hidden="true"
                  />
                  {KIND_LABELS[noteKind(inspectorNote)]}
                </span>
                <h3 className="graph-inspector-title">{inspectorNote.title}</h3>
                <button
                  type="button"
                  className="graph-inspector-close"
                  aria-label="关闭节点详情"
                  onClick={() => onSelectNote(null)}
                >
                  <Icon name="close" size={16} />
                </button>
              </header>
              {inspectorExcerpt ? (
                <p className="graph-inspector-excerpt">{inspectorExcerpt}</p>
              ) : (
                <p className="graph-inspector-excerpt graph-inspector-excerpt--empty">
                  这条记录还没有正文。
                </p>
              )}
              <div className="graph-inspector-connections">
                <span className="graph-inspector-label">连接 {inspectorContacts.length}</span>
                {inspectorContacts.length > 0 ? (
                  <div className="graph-inspector-chips">
                    {inspectorContacts.slice(0, 4).map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className="graph-chip"
                        disabled={!contact.exists}
                        onClick={() => {
                          if (!contact.exists) return;
                          if (onOpenRef.current) onOpenRef.current(contact.id);
                          else onSelectRef.current(contact.id);
                        }}
                      >
                        {contact.outgoing ? '→ ' : '← '}
                        {contact.title}
                      </button>
                    ))}
                    {inspectorContacts.length > 4 ? (
                      <span className="graph-chip graph-chip--muted">
                        +{inspectorContacts.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="graph-inspector-muted">暂时没有连接</span>
                )}
              </div>
              <footer className="graph-inspector-actions">
                <button
                  type="button"
                  className="graph-action"
                  onClick={() => handleEditSelected(inspectorNote.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="graph-action"
                  onClick={() => handleLinkFromSelected(inspectorNote.id)}
                >
                  连线
                </button>
                {onDeleteNote ? (
                  <button
                    type="button"
                    className="graph-action graph-action--danger"
                    onClick={() => handleDeleteSelected(inspectorNote.id)}
                  >
                    删除
                  </button>
                ) : null}
              </footer>
            </section>
            )
          ) : null}
        </>
      ) : (
        <div className="graph-empty">
          <div className="graph-empty-title">
            {directoriesOnly ? '还没有目录' : '记下第一件事'}
          </div>
          <div className="graph-empty-text">
            {directoriesOnly
              ? '先创建一个目录，比如身体健康、工作、学习、理财；一个小球就是一个目录。'
              : '图谱会从这里长出来'}
          </div>
          {directoriesOnly && onCreateDirectory ? (
            <button type="button" className="btn btn-primary graph-empty-cta" onClick={onCreateDirectory}>
              创建目录
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
