import { useEffect, useRef, useState } from 'react';
import type { Note, NoteKind, NotePosition } from '../lib/types';
import { buildGraph, layoutSync, seedPositions, tick } from '../lib/graph';
import type { Graph, GraphNode } from '../lib/graph';
import { KIND_INFO, NOTE_KINDS } from '../lib/kinds';
import { Icon } from './Icon';
import './GraphView.css';

/**
 * Editable life graph for 麻薯 v0.3.
 *
 * Notes are drawn as kind-coloured nodes; `[[wiki links]]`, hand-drawn links and
 * same-day life records become typed edges. Users can drag nodes (positions are
 * persisted normalized 0..1), tap a node to select it, tap empty space to drop a
 * new record, or flip into connect mode to draw a manual link.
 *
 * The force simulation runs through requestAnimationFrame; pan/zoom only change
 * a transform so they never restart it. The graph is rebuilt only when a cheap
 * fingerprint of the notes changes, and settled coordinates are carried over so
 * editing one record never reshuffles the whole map.
 */

export interface GraphViewProps {
  notes: Note[];
  /** Note currently open in the editor (small marker). */
  activeNoteId?: string | null;
  /** Node selected for the editor sheet (accent ring + halo). */
  selectedNoteId?: string | null;
  onSelectNote: (id: string | null) => void;
  /** Second tap on an already selected node (App opens the note). */
  onOpenNote?: (id: string) => void;
  /** Drag end: persist the node's normalised position (0..1). */
  onMoveNote: (id: string, position: NotePosition) => void;
  /** Add mode: create a note at a normalised canvas position (0..1). */
  onCreateNoteAt: (position: NotePosition) => void;
  /** Connect mode: draw a manual link between two notes. */
  onLinkNotes: (sourceId: string, targetId: string) => void;
  /** Toolbar "重新布局": App/store clears saved positions. */
  onRequestResetLayout?: () => void;
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

/** Calm paper/ink palette pulled from the design tokens (see styles/tokens.css). */
interface Palette {
  ghost: string;
  edge: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  text: string;
  textMuted: string;
  textFaint: string;
  surface: string;
  border: string;
  fontSans: string;
  theme: 'light' | 'dark';
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
const DEFAULT_TICK_BUDGET = 160;
/** Small settle only when a brand-new free node appears (e.g. from the editor). */
const ADDED_NODE_SETTLE_TICKS = 28;
const TICKS_PER_FRAME = 3;
const LABEL_FONT_SIZE = 11;
const SELECTED_LABEL_FONT_SIZE = 11.5;
const MAX_LABEL_CHARS = 14;
/** Nodes stay this far from the canvas edges (parity with lib/graph.ts). */
const NODE_MARGIN_MAX = 12;
/** Offscreen node sprites are baked at this multiple for crisp zooming. */
const SPRITE_SUPERSAMPLE = 2.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const FALLBACK_KIND_COLORS: Record<NoteKind, string> = {
  diary: '#6f88a3',
  food: '#b9735a',
  health: '#6f927c',
  finance: '#a8894f',
  note: '#8a8275',
};

const FALLBACK_PALETTE: Palette = {
  ghost: '#c9c2b6',
  edge: 'rgba(90, 120, 105, 0.3)',
  accent: '#6f9280',
  accentStrong: '#567c69',
  accentInk: '#47695a',
  text: '#3a352c',
  textMuted: '#6f675a',
  textFaint: '#8a8072',
  surface: '#ffffff',
  border: 'rgba(74, 62, 48, 0.1)',
  fontSans: '-apple-system, BlinkMacSystemFont, PingFang SC, system-ui, sans-serif',
  theme: 'light',
  kindColors: FALLBACK_KIND_COLORS,
};
const FALLBACK_RGBA: Rgba = { r: 111, g: 146, b: 128, a: 1 };

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

/** Blend two token colours (0 = a, 1 = b). */
function mixColor(a: string, b: string, amount: number): string {
  const from = parseColor(a) ?? FALLBACK_RGBA;
  const to = parseColor(b) ?? FALLBACK_RGBA;
  const t = clamp(amount, 0, 1);
  return `rgb(${Math.round(from.r + (to.r - from.r) * t)}, ${Math.round(
    from.g + (to.g - from.g) * t,
  )}, ${Math.round(from.b + (to.b - from.b) * t)})`;
}

function lightenColor(input: string, amount: number): string {
  return mixColor(input, '#ffffff', amount);
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

/** Visual radius grows with citation count, per the legend. */
function radiusForDegree(degree: number): number {
  return 5 + Math.sqrt(Math.max(0, degree)) * 2;
}

function truncateLabel(title: string): string {
  const text = title.trim();
  return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text;
}

/**
 * Significant nodes that get labels, focus (active/selected) last so those pills
 * draw above the rest. Shared by the renderer and the camera fit so both agree.
 */
function selectLabelNodes(
  graph: Graph,
  activeId: string | null,
  selectedId: string | null,
  width: number,
  height: number,
): GraphNode[] {
  const maxLabels = Math.round(clamp((width * height) / 48000, 3, 9));
  const bySignificance = [...graph.nodes].sort((a, b) => {
    if (b.degree !== a.degree) return b.degree - a.degree;
    if (a.ghost !== b.ghost) return a.ghost ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
  const labelled = new Set<string>();
  for (const node of bySignificance) {
    if (labelled.size >= maxLabels) break;
    if (!node.title.trim()) continue;
    labelled.add(node.id);
  }
  if (activeId) labelled.add(activeId);
  if (selectedId) labelled.add(selectedId);
  const focused = new Set<string>();
  if (activeId) focused.add(activeId);
  if (selectedId) focused.add(selectedId);
  return bySignificance
    .filter((node) => labelled.has(node.id))
    .sort((a, b) => Number(focused.has(a.id)) - Number(focused.has(b.id)));
}

/** Rounded-rect path (avoids relying on the newer ctx.roundRect). */
function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
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
  /** Baked node sprites keyed by kind colour + degree + theme (cheap re-draws). */
  const nodeSpriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const ticksDoneRef = useRef<number>(0);
  const tickBudgetRef = useRef<number>(DEFAULT_TICK_BUDGET);
  const resizeTimerRef = useRef<number | null>(null);
  /** False until the current graph has real (seeded) coordinates. */
  const layoutReadyRef = useRef<boolean>(false);
  const pointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);
  const reducedMotionRef = useRef<boolean>(false);
  /** Keep the camera fitted to the graph while the simulation settles. */
  const autoFitRef = useRef<boolean>(true);

  const [mode, setMode] = useState<GraphMode>('idle');
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [hasGhost, setHasGhost] = useState<boolean>(false);

  // Latest props kept in refs so the canvas loop always sees fresh values
  // without being torn down and rebuilt on every React render.
  const activeIdRef = useRef<string | null>(activeNoteId);
  const selectedIdRef = useRef<string | null>(selectedNoteId);
  const modeRef = useRef<GraphMode>(mode);
  const connectSourceRef = useRef<string | null>(connectSource);
  const onSelectRef = useRef(onSelectNote);
  const onOpenRef = useRef(onOpenNote);
  const onMoveRef = useRef(onMoveNote);
  const onCreateAtRef = useRef(onCreateNoteAt);
  const onLinkRef = useRef(onLinkNotes);
  const onResetRef = useRef(onRequestResetLayout);
  activeIdRef.current = activeNoteId;
  selectedIdRef.current = selectedNoteId;
  modeRef.current = mode;
  connectSourceRef.current = connectSource;
  onSelectRef.current = onSelectNote;
  onOpenRef.current = onOpenNote;
  onMoveRef.current = onMoveNote;
  onCreateAtRef.current = onCreateNoteAt;
  onLinkRef.current = onLinkNotes;
  onResetRef.current = onRequestResetLayout;

  /** Read design tokens from the container (cached per theme). */
  function getPalette(): Palette {
    const container = containerRef.current;
    const theme: 'light' | 'dark' =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const cached = paletteRef.current;
    if (cached && paletteThemeRef.current === theme) return cached;
    if (!container) return FALLBACK_PALETTE;
    // Theme flips re-bake node sprites with different shading.
    nodeSpriteCacheRef.current.clear();
    const styles = getComputedStyle(container);
    const read = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    const kindColors = {} as Record<NoteKind, string>;
    for (const kind of NOTE_KINDS) {
      kindColors[kind] = read(KIND_INFO[kind].accentVar, FALLBACK_KIND_COLORS[kind]);
    }
    const palette: Palette = {
      ghost: read('--graph-node-ghost', FALLBACK_PALETTE.ghost),
      edge: read('--graph-edge', FALLBACK_PALETTE.edge),
      accent: read('--accent', FALLBACK_PALETTE.accent),
      accentStrong: read('--accent-strong', FALLBACK_PALETTE.accentStrong),
      accentInk: read('--accent-ink', FALLBACK_PALETTE.accentInk),
      text: read('--text', FALLBACK_PALETTE.text),
      textMuted: read('--text-muted', FALLBACK_PALETTE.textMuted),
      textFaint: read('--text-faint', FALLBACK_PALETTE.textFaint),
      surface: read('--surface', FALLBACK_PALETTE.surface),
      border: read('--border', FALLBACK_PALETTE.border),
      fontSans: read('--font-sans', FALLBACK_PALETTE.fontSans),
      theme,
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

  /** Pixels a node must stay away from the canvas edges (parity with lib). */
  function nodeMarginX(width: number): number {
    return Math.min(NODE_MARGIN_MAX, width * 0.04);
  }

  function nodeMarginY(height: number): number {
    return Math.min(NODE_MARGIN_MAX, height * 0.04);
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

  /** Bake one calm node sprite into an offscreen canvas (cached). */
  function nodeSprite(palette: Palette, kind: NoteKind, degree: number): HTMLCanvasElement {
    const baseColor = palette.kindColors[kind] ?? FALLBACK_KIND_COLORS.note;
    const cache = nodeSpriteCacheRef.current;
    const key = `${baseColor}|${degree}|${palette.theme}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const radius = radiusForDegree(degree);
    // Padding keeps the baked soft shadow from being clipped at the edge.
    const pad = Math.max(3, radius * 0.85 + 3);
    const worldSize = (radius + pad) * 2;
    const pixelSize = Math.max(8, Math.ceil(worldSize * SPRITE_SUPERSAMPLE));
    const sprite = document.createElement('canvas');
    sprite.width = pixelSize;
    sprite.height = pixelSize;
    const spriteContext = sprite.getContext('2d');
    if (!spriteContext) return sprite;

    spriteContext.scale(pixelSize / worldSize, pixelSize / worldSize);
    spriteContext.translate(worldSize / 2, worldSize / 2);

    // Soft drop shadow, baked once instead of paying shadowBlur every frame.
    spriteContext.save();
    spriteContext.shadowColor = colorToRgba(
      palette.accentStrong,
      palette.theme === 'dark' ? 0.34 : 0.18,
    );
    spriteContext.shadowBlur = radius * 0.8;
    spriteContext.shadowOffsetY = radius * 0.16;
    spriteContext.fillStyle = baseColor;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();
    spriteContext.restore();

    // Body: gentle top-left light → kind colour → slightly deeper rim.
    const body = spriteContext.createRadialGradient(
      -radius * 0.32,
      -radius * 0.38,
      radius * 0.1,
      0,
      0,
      radius * 1.12,
    );
    body.addColorStop(0, lightenColor(baseColor, palette.theme === 'dark' ? 0.32 : 0.5));
    body.addColorStop(0.42, lightenColor(baseColor, 0.16));
    body.addColorStop(0.78, baseColor);
    body.addColorStop(1, mixColor(baseColor, palette.theme === 'dark' ? '#000000' : '#3a352c', 0.22));
    spriteContext.fillStyle = body;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();

    // Quiet sheen.
    const sheen = spriteContext.createRadialGradient(
      -radius * 0.34,
      -radius * 0.4,
      0,
      -radius * 0.34,
      -radius * 0.4,
      radius * 0.7,
    );
    sheen.addColorStop(0, palette.theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    spriteContext.fillStyle = sheen;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();

    // Thin lighter rim so the dot reads as a soft physical token.
    spriteContext.strokeStyle =
      palette.theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)';
    spriteContext.lineWidth = Math.max(1, radius * 0.1);
    spriteContext.beginPath();
    spriteContext.arc(0, 0, Math.max(0.5, radius - spriteContext.lineWidth * 0.5), 0, Math.PI * 2);
    spriteContext.stroke();

    cache.set(key, sprite);
    return sprite;
  }

  /** Draw a baked node at its layout position. */
  function drawNode(
    context: CanvasRenderingContext2D,
    palette: Palette,
    node: GraphNode,
    scaleFactor: number,
  ): void {
    const sprite = nodeSprite(palette, node.kind, node.degree);
    const worldSize = (sprite.width / SPRITE_SUPERSAMPLE) * scaleFactor;
    context.drawImage(sprite, node.x - worldSize / 2, node.y - worldSize / 2, worldSize, worldSize);
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
    const pendingSource = modeRef.current === 'connect' ? connectSourceRef.current : null;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (graph.nodes.length === 0) return;
    if (!layoutReadyRef.current) return;

    const nodeById = new Map<string, GraphNode>();
    for (const node of graph.nodes) nodeById.set(node.id, node);

    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const traceEdges = (accept: (edgeType: string) => boolean): void => {
      context.beginPath();
      for (const edge of graph.edges) {
        if (!accept(edge.type)) continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
      }
      context.stroke();
    };

    // ---- edges: day chains faint dashed, wiki solid, manual stronger ----
    context.setLineDash([3.2 / view.scale, 3.2 / view.scale]);
    context.strokeStyle = colorToRgba(palette.edge, 0.34);
    context.lineWidth = 1.1 / view.scale;
    traceEdges((type) => type === 'day');
    context.setLineDash([]);

    context.strokeStyle = palette.edge;
    context.lineWidth = 1.3 / view.scale;
    traceEdges((type) => type === 'wiki');

    context.strokeStyle = colorToRgba(palette.accent, 0.58);
    context.lineWidth = 1.7 / view.scale;
    traceEdges((type) => type === 'manual');

    // Edges touching the selected or active note read a little stronger.
    const focusIds = new Set<string>();
    if (selectedId) focusIds.add(selectedId);
    if (activeId) focusIds.add(activeId);
    if (focusIds.size > 0) {
      context.strokeStyle = colorToRgba(palette.accentStrong, 0.5);
      context.lineWidth = 2.3 / view.scale;
      context.beginPath();
      for (const edge of graph.edges) {
        if (!focusIds.has(edge.source) && !focusIds.has(edge.target)) continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
      }
      context.stroke();
    }

    // ---- unresolved links: hollow dashed circles ----
    context.strokeStyle = colorToRgba(palette.ghost, palette.theme === 'dark' ? 0.85 : 0.95);
    for (const node of graph.nodes) {
      if (!node.ghost) continue;
      const radius = radiusForDegree(node.degree);
      context.setLineDash([3.6 / view.scale, 3.2 / view.scale]);
      context.lineWidth = 1.4 / view.scale;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);

    // ---- nodes: smaller ones behind, focused ones last ----
    const focusDrawOrder = graph.nodes
      .filter(
        (node) => !node.ghost && node.id !== selectedId && node.id !== activeId,
      )
      .sort((a, b) => a.degree - b.degree);
    for (const node of focusDrawOrder) drawNode(context, palette, node, 1);
    const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
    const activeNode = activeId && activeId !== selectedId ? nodeById.get(activeId) : undefined;
    if (selectedNode && !selectedNode.ghost) drawNode(context, palette, selectedNode, 1.04);
    if (activeNode && !activeNode.ghost) drawNode(context, palette, activeNode, 1);

    // ---- focus decorations (rings, halo, active dot) ----
    const drawRing = (
      node: GraphNode,
      color: string,
      lineWidth: number,
      dash: number[] | null,
    ): void => {
      const radius = radiusForDegree(node.degree) + 4.5 / view.scale;
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash(dash ?? []);
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    };

    if (selectedNode && !selectedNode.ghost) {
      const radius = radiusForDegree(selectedNode.degree);
      const haloRadius = radius + 11 / view.scale;
      const halo = context.createRadialGradient(
        selectedNode.x,
        selectedNode.y,
        radius * 0.8,
        selectedNode.x,
        selectedNode.y,
        haloRadius,
      );
      halo.addColorStop(0, colorToRgba(palette.accent, 0.28));
      halo.addColorStop(1, colorToRgba(palette.accent, 0));
      context.fillStyle = halo;
      context.beginPath();
      context.arc(selectedNode.x, selectedNode.y, haloRadius, 0, Math.PI * 2);
      context.fill();
      drawRing(selectedNode, colorToRgba(palette.accent, 0.95), 2 / view.scale, null);
    }

    if (pendingSource) {
      const sourceNode = nodeById.get(pendingSource);
      if (sourceNode) {
        drawRing(
          sourceNode,
          colorToRgba(palette.accentStrong, 0.9),
          1.8 / view.scale,
          [4 / view.scale, 3 / view.scale],
        );
      }
    }

    // Active note: a small dot so the open note is findable without noise.
    if (activeNode && !activeNode.ghost) {
      const radius = radiusForDegree(activeNode.degree);
      const dotRadius = Math.max(2.2, 2.8 / view.scale);
      const dotX = activeNode.x + radius * 0.68;
      const dotY = activeNode.y - radius * 0.68;
      context.beginPath();
      context.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      context.fillStyle = palette.accentStrong;
      context.fill();
      context.lineWidth = 1.4 / view.scale;
      context.strokeStyle = palette.surface;
      context.stroke();
    }

    // ---- labels: soft pills, screen space so text stays crisp ----
    const labelNodes = selectLabelNodes(graph, activeId, selectedId, width, height);
    const focused = new Set<string>();
    if (activeId) focused.add(activeId);
    if (selectedId) focused.add(selectedId);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const takenLabelAreas: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const node of labelNodes) {
      const label = truncateLabel(node.title);
      if (!label) continue;
      const isSelected = node.id === selectedId;
      const isFocused = focused.has(node.id);
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      const radius = radiusForDegree(node.degree) * view.scale;
      if (screenX < -140 || screenX > width + 140 || screenY < -50 || screenY > height + 50) {
        continue;
      }

      context.font = isSelected
        ? `700 ${SELECTED_LABEL_FONT_SIZE}px ${palette.fontSans}`
        : `600 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
      const textWidth = context.measureText(label).width;
      const pillHeight = isSelected ? 22 : 19;
      const pillWidth = Math.min(textWidth + 16, width - 12);
      const pillX = clamp(screenX - pillWidth / 2, 6, Math.max(6, width - pillWidth - 6));
      let pillY = screenY + radius + 7;
      if (pillY + pillHeight > height - 6) pillY = screenY - radius - 7 - pillHeight;
      pillY = clamp(pillY, 6, Math.max(6, height - pillHeight - 6));

      if (!isFocused) {
        const overlaps = takenLabelAreas.some(
          (area) =>
            pillX < area.right + 3 &&
            pillX + pillWidth > area.left - 3 &&
            pillY < area.bottom + 3 &&
            pillY + pillHeight > area.top - 3,
        );
        if (overlaps) continue;
      }
      takenLabelAreas.push({
        left: pillX,
        right: pillX + pillWidth,
        top: pillY,
        bottom: pillY + pillHeight,
      });

      roundRectPath(context, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
      context.fillStyle = colorToRgba(palette.surface, isSelected ? 0.94 : 0.84);
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = isSelected ? colorToRgba(palette.accent, 0.6) : palette.border;
      context.stroke();

      context.fillStyle = isSelected
        ? palette.accentInk
        : node.ghost
          ? palette.textFaint
          : isFocused
            ? palette.text
            : palette.textMuted;
      context.fillText(label, pillX + pillWidth / 2, pillY + pillHeight / 2 + 0.5);
    }
  }

  /**
   * Canvas-local rectangle the graph content must stay inside. It excludes the
   * floating toolbar (right), the legend (bottom-left) and the mode hint (top),
   * plus a little breathing room. This is what keeps nodes/labels off the bottom
   * navigation scrim on a phone.
   */
  function getSafeRect(width: number, height: number): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const base = 14;
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
        else top = Math.max(top, rect.bottom - canvasRect.top + 10);
      };
      reserve('.graph-toolbar', 'right');
      reserve('.graph-legend', 'bottom');
      reserve('.graph-hint', 'top');
    }
    // Never let a cramped layout collapse the play area entirely.
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

  /**
   * Union of node balls (plus focus rings) and label pills in screen space for a
   * candidate camera, so the fit can account for the fixed-size text labels.
   */
  function measureFitContent(
    scale: number,
    tx: number,
    ty: number,
    labelNodes: GraphNode[],
  ): { left: number; top: number; right: number; bottom: number } {
    const graph = graphRef.current;
    if (!graph) return { left: 0, top: 0, right: 1, bottom: 1 };
    const selectedId = selectedIdRef.current;
    const activeId = activeIdRef.current;
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

    for (const node of graph.nodes) {
      const radius = radiusForDegree(node.degree) * scale;
      const padding = node.id === selectedId ? 12 : 6;
      const screenX = node.x * scale + tx;
      const screenY = node.y * scale + ty;
      include(
        screenX - radius - padding,
        screenY - radius - padding,
        screenX + radius + padding,
        screenY + radius + padding,
      );
      if (node.id === activeId) {
        // Small "open note" dot at the node's top-right.
        include(screenX + radius - 2, screenY - radius - 8, screenX + radius + 10, screenY - radius + 4);
      }
    }

    const context = canvasRef.current?.getContext('2d');
    if (context) {
      const palette = getPalette();
      const canvasWidth = sizeRef.current.width;
      for (const node of labelNodes) {
        const label = truncateLabel(node.title);
        if (!label) continue;
        const selected = node.id === selectedId;
        context.font = selected
          ? `700 ${SELECTED_LABEL_FONT_SIZE}px ${palette.fontSans}`
          : `600 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
        const labelWidth = Math.min(context.measureText(label).width + 16, canvasWidth - 12);
        const labelHeight = selected ? 22 : 19;
        const radius = radiusForDegree(node.degree) * scale;
        const screenX = node.x * scale + tx;
        const screenY = node.y * scale + ty;
        const pillTop = screenY + radius + 7;
        include(screenX - labelWidth / 2, pillTop, screenX + labelWidth / 2, pillTop + labelHeight);
      }
    }

    return { left, top, right, bottom };
  }

  /**
   * Camera that fits every node ball and label pill inside the overlay-safe area.
   * Labels are fixed screen-pixel size, so the fit iterates a few times.
   */
  function computeFitView(): Viewport {
    const graph = graphRef.current;
    const { width, height } = sizeRef.current;
    if (!graph || graph.nodes.length === 0 || width < 2 || height < 2) {
      return { scale: 1, tx: 0, ty: 0 };
    }

    const safe = getSafeRect(width, height);
    const availableWidth = Math.max(40, safe.right - safe.left - 8);
    const availableHeight = Math.max(40, safe.bottom - safe.top - 8);
    const targetX = (safe.left + safe.right) / 2;
    const targetY = (safe.top + safe.bottom) / 2;
    const labelNodes = selectLabelNodes(
      graph,
      activeIdRef.current,
      selectedIdRef.current,
      width,
      height,
    );

    // First guess: fit the node balls only, then iterate labels + overlays in.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      const radius = radiusForDegree(node.degree) + (node.id === selectedIdRef.current ? 12 : 6);
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
      const content = measureFitContent(scale, tx, ty, labelNodes);
      // Re-centre the measured content, then shrink if it still overflows.
      tx += targetX - (content.left + content.right) / 2;
      ty += targetY - (content.top + content.bottom) / 2;
      const usedWidth = Math.max(1, content.right - content.left);
      const usedHeight = Math.max(1, content.bottom - content.top);
      const overflow = Math.min(1, availableWidth / usedWidth, availableHeight / usedHeight);
      if (overflow > 0.995) break;
      const nextScale = clamp(scale * overflow * 0.995, MIN_SCALE, 1.6);
      if (Math.abs(nextScale - scale) < 0.0005) break;
      // Scale around the safe-area centre (content is centred there by now).
      tx = targetX - ((targetX - tx) / scale) * nextScale;
      ty = targetY - ((targetY - ty) / scale) * nextScale;
      scale = nextScale;
    }

    // Final nudge: guarantee the measured content sits inside the safe rect.
    const finalContent = measureFitContent(scale, tx, ty, labelNodes);
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

  function animateFrame(): void {
    rafRef.current = null;
    const graph = graphRef.current;
    if (!graph) return;
    const { width, height } = sizeRef.current;
    if (width < 2 || height < 2) return;
    const budget = tickBudgetRef.current;
    for (let step = 0; step < TICKS_PER_FRAME && ticksDoneRef.current < budget; step += 1) {
      tick(graph, width, height);
      ticksDoneRef.current += 1;
    }
    const settled = ticksDoneRef.current >= budget;
    if (autoFitRef.current) {
      if (settled) fitView();
      else followView();
    }
    draw();
    if (!settled) rafRef.current = requestAnimationFrame(animateFrame);
  }

  /** Map saved positions onto the current canvas (used when preserving). */
  function placeSavedNodes(graph: Graph, width: number, height: number): void {
    const marginX = nodeMarginX(width);
    const marginY = nodeMarginY(height);
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
   * `reseed = true` rebuilds the deterministic spiral (fresh layout / resize).
   * `reseed = false` keeps every settled coordinate untouched (drag, add, edit),
   * so a small edit never reshuffles the map; `settleTicks` may request a short
   * settle for brand-new free nodes only.
   */
  function startLayout(reseed: boolean, settleTicks?: number): void {
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
      viewRef.current = { scale: 1, tx: 0, ty: 0 };
      draw();
      return;
    }
    if (width < 2 || height < 2) {
      layoutReadyRef.current = false;
      return;
    }

    if (reseed) seedPositions(graph, width, height);
    else placeSavedNodes(graph, width, height);
    layoutReadyRef.current = true;

    const budget = reseed
      ? DEFAULT_TICK_BUDGET
      : Math.max(0, settleTicks ?? 0);
    const reduced = reducedMotionRef.current;
    if (reduced) {
      const staticSteps = reseed ? (graph.nodes.length > 400 ? 80 : 220) : budget;
      if (reseed) layoutSync(graph, width, height, staticSteps);
      else for (let i = 0; i < staticSteps; i += 1) tick(graph, width, height);
      if (reseed || autoFitRef.current) fitView();
      draw();
      return;
    }

    if (reseed || autoFitRef.current) fitView();
    if (budget <= 0) {
      draw();
      return;
    }
    ticksDoneRef.current = 0;
    tickBudgetRef.current = graph.nodes.length > 400 ? Math.min(100, budget) : budget;
    draw();
    rafRef.current = requestAnimationFrame(animateFrame);
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
    let best: GraphNode | null = null;
    let bestDistance = Infinity;
    for (const node of graph.nodes) {
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      const distance = Math.hypot(px - screenX, py - screenY);
      // Generous hit target: comfortable for fingers on a phone.
      const hitRadius = Math.max(20, radiusForDegree(node.degree) * view.scale + 12);
      if (distance <= hitRadius && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  // ---- tap / selection / linking ----

  function handleNodeTap(node: GraphNode): void {
    const currentMode = modeRef.current;
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
      setMode('idle');
      draw();
      return;
    }

    // Idle / add mode: select, second tap on the same node opens it.
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
    // Ghost nodes are unresolved `[[wiki links]]`, not editable records.
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
    draw();
  }

  function handlePointerDown(event: PointerEvent): void {
    const canvas = canvasRef.current;
    const graph = graphRef.current;
    if (!canvas || !graph || graph.nodes.length === 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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
      // A second finger switches to pinch zoom; abandon (and revert) any drag.
      cancelDrag(true);
      beginPinchIfNeeded();
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
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
      const marginX = nodeMarginX(width);
      const marginY = nodeMarginY(height);
      node.fixed = true;
      node.x = clamp(world.x + drag.offsetX, marginX, Math.max(marginX, width - marginX));
      node.y = clamp(world.y + drag.offsetY, marginY, Math.max(marginY, height - marginY));
      node.vx = 0;
      node.vy = 0;
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
      // One finger lifted from a pinch: keep panning with the other one, no tap.
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
    setMode('idle');
    setConnectSource(null);
    lastTapRef.current = null;
    dragRef.current = null;
    const graph = graphRef.current;
    if (graph) {
      for (const node of graph.nodes) {
        node.fixed = false;
        node.position = undefined;
      }
    }
    onResetRef.current?.();
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
  }

  function toggleConnectMode(): void {
    setMode((current) => (current === 'connect' ? 'idle' : 'connect'));
    setConnectSource(null);
    lastTapRef.current = null;
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
    window.addEventListener('resize', handleWindowResize);

    const handleMotionChange = (): void => {
      reducedMotionRef.current = media.matches;
      startLayout(false, media.matches ? 200 : 0);
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
      window.removeEventListener('resize', handleWindowResize);
      media.removeEventListener('change', handleMotionChange);
      themeObserver.disconnect();
      pointersRef.current.clear();
      pinchRef.current = null;
      dragRef.current = null;
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

    const preserve = previous !== null && previousFingerprint !== null;
    let settleTicks = 0;
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
          // New free node (e.g. created in the editor): drop it in a calm spiral
          // slot, then let the neighbours make a little room.
          settleTicks = ADDED_NODE_SETTLE_TICKS;
          if (width > 4 && height > 4) {
            const radius = 36 + Math.sqrt(index + 1) * 16;
            node.x = width / 2 + Math.cos(index * GOLDEN_ANGLE) * radius;
            node.y = height / 2 + Math.sin(index * GOLDEN_ANGLE) * radius;
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

    startLayout(!preserve, settleTicks);
  }, [notes]);

  // Selection / active note changes are pure redraws.
  useEffect(() => {
    draw();
  }, [activeNoteId, selectedNoteId]);

  // Mode changes toggle cursors, hints and pending-source rings.
  useEffect(() => {
    draw();
  }, [mode, connectSource]);

  const hint =
    mode === 'add'
      ? '点空白处放一个新点'
      : mode === 'connect'
        ? connectSource
          ? '再点一个点完成连线'
          : '点两个点，把它们连起来'
        : null;

  const presentKinds = NOTE_KINDS.filter((kind) => notes.some((note) => noteKind(note) === kind));

  return (
    <div
      className={`graph-view${mode === 'add' ? ' is-adding' : ''}${
        mode === 'connect' ? ' is-connecting' : ''
      }`}
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="img"
        aria-label="生活图谱画布，可拖动平移、双指缩放，拖动节点可调整位置"
      />
      {notes.length > 0 ? (
        <>
          {hint ? (
            <div className="graph-hint" role="status">
              {hint}
            </div>
          ) : null}
          <div className="graph-toolbar" role="toolbar" aria-label="图谱工具">
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={() => zoomBy(ZOOM_STEP)}
              aria-label="放大"
              title="放大"
            >
              <Icon name="zoomIn" size={20} />
            </button>
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              aria-label="缩小"
              title="缩小"
            >
              <Icon name="zoomOut" size={20} />
            </button>
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={handleFit}
              aria-label="适应画布"
              title="适应画布"
            >
              <Icon name="fit" size={20} />
            </button>
            <span className="graph-toolbar-sep" aria-hidden="true" />
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={toggleAddMode}
              aria-label="添加记录"
              title="添加记录"
              aria-pressed={mode === 'add'}
            >
              <Icon name="plus" size={20} />
            </button>
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={toggleConnectMode}
              aria-label="连线"
              title="连线"
              aria-pressed={mode === 'connect'}
            >
              <Icon name="link" size={20} />
            </button>
            <span className="graph-toolbar-sep" aria-hidden="true" />
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={handleResetLayout}
              aria-label="重新布局"
              title="重新布局"
            >
              <Icon name="refresh" size={20} />
            </button>
          </div>
          <div className="graph-legend" aria-label="图例">
            {presentKinds.map((kind) => {
              const info = KIND_INFO[kind];
              return (
                <span key={kind} className="graph-legend-item">
                  <span
                    className="graph-legend-dot"
                    style={{ backgroundColor: `var(${info.accentVar})` }}
                    aria-hidden="true"
                  />
                  <span>
                    {info.emoji} {info.label}
                  </span>
                </span>
              );
            })}
            {hasGhost ? (
              <span className="graph-legend-item">
                <span
                  className="graph-legend-dot graph-legend-dot--ghost"
                  aria-hidden="true"
                />
                <span>未创建</span>
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="empty graph-empty">
          <div className="graph-empty-badge" aria-hidden="true">
            <Icon name="graph" size={26} />
          </div>
          <div className="empty-title">还没有记录，去记一笔吧</div>
          <div className="empty-text">写下的每一笔都会变成图谱里的一个点，慢慢连成你的生活。</div>
        </div>
      )}
    </div>
  );
}
