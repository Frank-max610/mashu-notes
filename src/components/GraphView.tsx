import { useEffect, useRef } from 'react';
import type { Note } from '../lib/types';
import { buildGraph, layoutSync, seedPositions, tick } from '../lib/graph';
import type { Graph, GraphNode } from '../lib/graph';
import { Icon } from './Icon';
import { Mascot } from './Mascot';
import './GraphView.css';

/**
 * Canvas graph view for the vault.
 *
 * Notes are drawn as nodes, `[[wiki links]]` as edges. The layout is simulated
 * with requestAnimationFrame; pan/zoom only change a transform so they never
 * restart the simulation. The graph is rebuilt only when a cheap fingerprint of
 * the notes (id + title + body hash) changes, so ordinary re-renders are free.
 */

export interface GraphViewProps {
  notes: Note[];
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}

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

interface PinchState {
  distance: number;
  midX: number;
  midY: number;
  scale: number;
  tx: number;
  ty: number;
}

/** Pastel palette pulled from the Mochi design tokens (see styles/tokens.css). */
interface Palette {
  node: string;
  node2: string;
  butter: string;
  mint: string;
  ghost: string;
  edge: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  textMuted: string;
  textFaint: string;
  surface: string;
  border: string;
  fontSans: string;
  theme: 'light' | 'dark';
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
const DEFAULT_TICK_BUDGET = 160;
const TICKS_PER_FRAME = 2;
const LABEL_FONT_SIZE = 11;
const ACTIVE_LABEL_FONT_SIZE = 11.5;
const MAX_LABEL_CHARS = 14;
/** Strawberry + taro dominate; butter + mint are the sprinkles. */
const NODE_HUE_ORDER = ['node', 'node2', 'node', 'node2', 'butter', 'mint'] as const;
/** Offscreen mochi sprites are baked at this multiple for crisp zooming. */
const SPRITE_SUPERSAMPLE = 2.5;

const FALLBACK_PALETTE: Palette = {
  node: '#ff9db4',
  node2: '#b79ced',
  butter: '#ffd98e',
  mint: '#8fdcbd',
  ghost: '#d9c8d1',
  edge: 'rgba(255, 141, 170, 0.32)',
  accent: '#ff9db4',
  accentStrong: '#e2557f',
  accentInk: '#cf3d6b',
  textMuted: '#8a6f7c',
  textFaint: '#b79aa7',
  surface: '#ffffff',
  border: 'rgba(214, 138, 158, 0.18)',
  fontSans: 'ui-rounded, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  theme: 'light',
};
const FALLBACK_RGBA: Rgba = { r: 255, g: 157, b: 180, a: 1 };

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
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(
      value,
    );
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

/** Fingerprint of everything the graph depends on. */
function fingerprintNotes(notes: Note[]): string {
  const parts: string[] = [];
  for (const note of notes) {
    parts.push(
      `${note.id}\u0001${note.title}\u0001${note.content.length}\u0001${hashString(note.content)}`,
    );
  }
  return parts.join('\u0002');
}

/** Visual radius grows with citation count, per the legend. */
function radiusForDegree(degree: number): number {
  // Plump little mochi: bigger citation counts get visibly rounder.
  return 5 + Math.sqrt(Math.max(0, degree)) * 2;
}

function nodeRadius(node: GraphNode): number {
  return radiusForDegree(node.degree);
}

/** Deterministic pastel hue so the same note always keeps its mochi colour. */
function nodeBaseColor(palette: Palette, node: GraphNode): string {
  const slot = NODE_HUE_ORDER[hashString(node.id) % NODE_HUE_ORDER.length] ?? 'node';
  return palette[slot];
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

function truncateLabel(title: string): string {
  const text = title.trim();
  return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text;
}

export function GraphView({ notes, activeNoteId, onOpenNote, onCreateNote }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const graphRef = useRef<Graph | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const viewRef = useRef<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const dprRef = useRef<number>(1);
  const paletteRef = useRef<Palette | null>(null);
  const paletteThemeRef = useRef<string>('');
  /** Baked mochi sprites keyed by colour + degree + theme (cheap pan/zoom). */
  const nodeSpriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const ticksDoneRef = useRef<number>(0);
  const tickBudgetRef = useRef<number>(DEFAULT_TICK_BUDGET);
  const resizeTimerRef = useRef<number | null>(null);
  /** False until the current graph has real (seeded) coordinates. */
  const layoutReadyRef = useRef<boolean>(false);
  const pointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const reducedMotionRef = useRef<boolean>(false);
  /** Keep the camera fitted to the graph while the simulation settles. */
  const autoFitRef = useRef<boolean>(true);

  // Latest props kept in refs so the canvas loop always sees fresh values
  // without being torn down and rebuilt on every React render.
  const activeIdRef = useRef<string | null>(activeNoteId);
  const onOpenNoteRef = useRef(onOpenNote);
  const onCreateNoteRef = useRef(onCreateNote);
  activeIdRef.current = activeNoteId;
  onOpenNoteRef.current = onOpenNote;
  onCreateNoteRef.current = onCreateNote;

  /** Read design tokens from the container (cached per theme). */
  function getPalette(): Palette {
    const container = containerRef.current;
    const theme: 'light' | 'dark' =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const cached = paletteRef.current;
    if (cached && paletteThemeRef.current === theme) return cached;
    if (!container) return FALLBACK_PALETTE;
    // Theme flips re-bake the mochi sprites with different shading.
    nodeSpriteCacheRef.current.clear();
    const styles = getComputedStyle(container);
    const read = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    const palette: Palette = {
      node: read('--graph-node', FALLBACK_PALETTE.node),
      node2: read('--graph-node-2', FALLBACK_PALETTE.node2),
      butter: read('--butter', FALLBACK_PALETTE.butter),
      mint: read('--mint', FALLBACK_PALETTE.mint),
      ghost: read('--graph-node-ghost', FALLBACK_PALETTE.ghost),
      edge: read('--graph-edge', FALLBACK_PALETTE.edge),
      accent: read('--accent', FALLBACK_PALETTE.accent),
      accentStrong: read('--accent-strong', FALLBACK_PALETTE.accentStrong),
      accentInk: read('--accent-ink', FALLBACK_PALETTE.accentInk),
      textMuted: read('--text-muted', FALLBACK_PALETTE.textMuted),
      textFaint: read('--text-faint', FALLBACK_PALETTE.textFaint),
      surface: read('--surface', FALLBACK_PALETTE.surface),
      border: read('--border', FALLBACK_PALETTE.border),
      fontSans: read('--font-sans', FALLBACK_PALETTE.fontSans),
      theme,
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

  /** Bake one mochi ball into an offscreen canvas (cached per hue + size + theme). */
  function mochiSprite(palette: Palette, baseColor: string, degree: number): HTMLCanvasElement {
    const cache = nodeSpriteCacheRef.current;
    const key = `${baseColor}|${degree}|${palette.theme}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const radius = radiusForDegree(degree);
    // Padding keeps the baked drop shadow from being clipped at the sprite edge.
    const pad = Math.max(4, radius * 1.1 + 3);
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
      palette.theme === 'dark' ? 0.42 : 0.3,
    );
    spriteContext.shadowBlur = radius * 0.9;
    spriteContext.shadowOffsetY = radius * 0.2;
    spriteContext.fillStyle = baseColor;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();
    spriteContext.restore();

    // Mochi body: milky highlight top-left, pastel middle, deeper rim.
    const body = spriteContext.createRadialGradient(
      -radius * 0.36,
      -radius * 0.42,
      radius * 0.12,
      0,
      0,
      radius * 1.14,
    );
    body.addColorStop(0, lightenColor(baseColor, palette.theme === 'dark' ? 0.58 : 0.6));
    body.addColorStop(0.38, lightenColor(baseColor, palette.theme === 'dark' ? 0.3 : 0.2));
    body.addColorStop(0.76, baseColor);
    body.addColorStop(
      1,
      mixColor(baseColor, palette.accentInk, palette.theme === 'dark' ? 0.18 : 0.34),
    );
    spriteContext.fillStyle = body;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();

    // Glossy sheen.
    const sheen = spriteContext.createRadialGradient(
      -radius * 0.36,
      -radius * 0.44,
      0,
      -radius * 0.36,
      -radius * 0.44,
      radius * 0.62,
    );
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    spriteContext.fillStyle = sheen;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, 0, Math.PI * 2);
    spriteContext.fill();

    // Chubby mochi get a blush pair…
    if (degree >= 2) {
      const blushX = radius * 0.44;
      const blushY = radius * 0.3;
      spriteContext.fillStyle = colorToRgba(
        palette.accentStrong,
        palette.theme === 'dark' ? 0.34 : 0.26,
      );
      spriteContext.beginPath();
      spriteContext.ellipse(-blushX, blushY, radius * 0.24, radius * 0.15, 0, 0, Math.PI * 2);
      spriteContext.ellipse(blushX, blushY, radius * 0.24, radius * 0.15, 0, 0, Math.PI * 2);
      spriteContext.fill();
    }

    // …and the popular ones get a tiny glossy sparkle.
    if (degree >= 4) {
      spriteContext.fillStyle = 'rgba(255, 255, 255, 0.85)';
      spriteContext.beginPath();
      spriteContext.arc(radius * 0.34, -radius * 0.52, Math.max(1, radius * 0.11), 0, Math.PI * 2);
      spriteContext.fill();
    }

    // Translucent lighter rim so the ball reads as soft mochi.
    spriteContext.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    spriteContext.lineWidth = Math.max(1.5, radius * 0.16);
    spriteContext.beginPath();
    spriteContext.arc(0, 0, Math.max(0.5, radius - spriteContext.lineWidth * 0.45), 0, Math.PI * 2);
    spriteContext.stroke();

    cache.set(key, sprite);
    return sprite;
  }

  /** Draw a baked mochi ball at a node position (active balls are a touch bigger). */
  function drawMochi(
    context: CanvasRenderingContext2D,
    palette: Palette,
    node: GraphNode,
    scaleFactor: number,
  ): void {
    const sprite = mochiSprite(palette, nodeBaseColor(palette, node), node.degree);
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
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (graph.nodes.length === 0) return;
    if (!layoutReadyRef.current) return;

    const nodeById = new Map<string, GraphNode>();
    for (const node of graph.nodes) nodeById.set(node.id, node);

    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // ---- edges: soft strawberry-milk threads (no arrowheads) ----
    const traceEdges = (accept: (source: GraphNode, target: GraphNode) => boolean): void => {
      context.beginPath();
      for (const edge of graph.edges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target || !accept(source, target)) continue;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
      }
      context.stroke();
    };

    // Soft under-glow keeps edges from looking like hairlines on a phone.
    context.globalAlpha = 0.36;
    context.strokeStyle = palette.edge;
    context.lineWidth = 2.8 / view.scale;
    traceEdges(() => true);

    context.globalAlpha = 1;
    context.strokeStyle = palette.edge;
    context.lineWidth = 1.4 / view.scale;
    traceEdges(() => true);

    // Threads attached to the active note are brighter and slightly thicker.
    if (activeId) {
      context.strokeStyle = colorToRgba(palette.accentStrong, 0.72);
      context.lineWidth = 2.1 / view.scale;
      traceEdges((source, target) => source.id === activeId || target.id === activeId);
    }

    // ---- ghost notes: hollow dashed mochi outlines ----
    const ghostStroke =
      palette.theme === 'dark'
        ? colorToRgba(palette.ghost, 0.85)
        : colorToRgba(mixColor(palette.ghost, palette.textMuted, 0.42), 1);
    for (const node of graph.nodes) {
      if (!node.ghost) continue;
      const radius = radiusForDegree(node.degree);
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.setLineDash([4 / view.scale, 3.2 / view.scale]);
      context.lineWidth = 1.7 / view.scale;
      context.strokeStyle = ghostStroke;
      context.stroke();
      context.setLineDash([]);
    }

    // ---- mochi balls: small ones behind, active ball last and glowing ----
    const activeNode = activeId ? nodeById.get(activeId) ?? null : null;
    const drawOrder = graph.nodes
      .filter((node) => !node.ghost && node.id !== activeId)
      .sort((a, b) => a.degree - b.degree);
    for (const node of drawOrder) {
      drawMochi(context, palette, node, 1);
    }

    if (activeNode) {
      const radius = radiusForDegree(activeNode.degree);
      const haloRadius = radius + 10 / view.scale;
      const halo = context.createRadialGradient(
        activeNode.x,
        activeNode.y,
        radius * 0.75,
        activeNode.x,
        activeNode.y,
        haloRadius,
      );
      halo.addColorStop(0, colorToRgba(palette.accent, 0.42));
      halo.addColorStop(0.6, colorToRgba(palette.accent, 0.16));
      halo.addColorStop(1, colorToRgba(palette.accent, 0));
      context.fillStyle = halo;
      context.beginPath();
      context.arc(activeNode.x, activeNode.y, haloRadius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = colorToRgba(palette.accent, 0.9);
      context.lineWidth = 2.2 / view.scale;
      context.beginPath();
      context.arc(activeNode.x, activeNode.y, radius + 3.4 / view.scale, 0, Math.PI * 2);
      context.stroke();

      drawMochi(context, palette, activeNode, 1.12);
    }

    // ---- labels: pastel pills, drawn in screen space so text stays crisp ----
    // Phones get a handful of labels, desktop a few more: never a wall of text.
    const maxLabels = Math.round(clamp((width * height) / 32000, 4, 12));
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

    // Active label draws last so it sits above the other pills.
    const labelOrder = bySignificance
      .filter((node) => labelled.has(node.id))
      .sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId));

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const takenLabelAreas: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const node of labelOrder) {
      const label = truncateLabel(node.title);
      if (!label) continue;
      const isActive = node.id === activeId;
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      const radius = radiusForDegree(node.degree) * view.scale;
      if (screenX < -140 || screenX > width + 140 || screenY < -50 || screenY > height + 50) {
        continue;
      }

      context.font = isActive
        ? `700 ${ACTIVE_LABEL_FONT_SIZE}px ${palette.fontSans}`
        : `600 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
      const textWidth = context.measureText(label).width;
      const pillHeight = isActive ? 22 : 19;
      const pillWidth = Math.min(textWidth + 16, width - 12);
      const pillX = clamp(screenX - pillWidth / 2, 6, Math.max(6, width - pillWidth - 6));
      let pillY = screenY + radius + 7;
      if (pillY + pillHeight > height - 6) pillY = screenY - radius - 7 - pillHeight;
      pillY = clamp(pillY, 6, Math.max(6, height - pillHeight - 6));

      if (!isActive) {
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

      // Soft pill behind the text keeps labels readable on light and dark bg.
      roundRectPath(context, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
      context.fillStyle = colorToRgba(palette.surface, isActive ? 0.92 : 0.82);
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = isActive ? colorToRgba(palette.accent, 0.55) : palette.border;
      context.stroke();

      context.fillStyle = isActive
        ? palette.accentInk
        : node.ghost
          ? palette.textFaint
          : palette.textMuted;
      context.fillText(label, pillX + pillWidth / 2, pillY + pillHeight / 2 + 0.5);
    }
  }

  function computeFitView(): Viewport {
    const graph = graphRef.current;
    const { width, height } = sizeRef.current;
    if (!graph || graph.nodes.length === 0 || width < 2 || height < 2) {
      return { scale: 1, tx: 0, ty: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      const radius = nodeRadius(node);
      minX = Math.min(minX, node.x - radius);
      minY = Math.min(minY, node.y - radius);
      maxX = Math.max(maxX, node.x + radius);
      maxY = Math.max(maxY, node.y + radius);
    }
    const padding = Math.min(36, width * 0.09, height * 0.09);
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const scale = clamp(
      Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight),
      MIN_SCALE,
      1.8,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return {
      scale,
      tx: width / 2 - centerX * scale,
      ty: height / 2 - centerY * scale,
    };
  }

  function fitView(): void {
    viewRef.current = computeFitView();
  }

  /**
   * Ease the camera toward the current graph bounds. The layout grows while it
   * settles, so a one-off fit at seed time would let nodes drift past the edges;
   * following the bounds keeps everything on screen and ends exactly fitted.
   */
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

  /** (Re)seed and run the layout for the current graph + canvas size. */
  function startLayout(): void {
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
    // The container can be zero-sized while a screen transition is running:
    // wait for the ResizeObserver instead of simulating in a 1×1 box.
    if (width < 2 || height < 2) {
      layoutReadyRef.current = false;
      return;
    }
    if (reducedMotionRef.current) {
      const steps = graph.nodes.length > 400 ? 80 : graph.nodes.length > 120 ? 140 : 240;
      autoFitRef.current = true;
      layoutSync(graph, width, height, steps);
      layoutReadyRef.current = true;
      fitView();
      draw();
      return;
    }
    seedPositions(graph, width, height);
    layoutReadyRef.current = true;
    autoFitRef.current = true;
    fitView();
    ticksDoneRef.current = 0;
    tickBudgetRef.current = graph.nodes.length > 400 ? 100 : DEFAULT_TICK_BUDGET;
    draw();
    rafRef.current = requestAnimationFrame(animateFrame);
  }

  /** Resize re-layouts are debounced so dragging a window stays calm. */
  function scheduleRelayout(): void {
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      startLayout();
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
      const hitRadius = Math.max(18, nodeRadius(node) * view.scale + 10);
      if (distance <= hitRadius && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function handleTap(px: number, py: number): void {
    const node = findNodeAt(px, py);
    if (!node) return;
    if (node.ghost) onCreateNoteRef.current(node.title);
    else onOpenNoteRef.current(node.id);
  }

  // ---- pointer / wheel handlers (attached natively so wheel can preventDefault) ----

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

  function handlePointerDown(event: PointerEvent): void {
    const canvas = canvasRef.current;
    const graph = graphRef.current;
    if (!canvas || !graph || graph.nodes.length === 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    autoFitRef.current = false;
    const position = eventPosition(event);
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
    beginPinchIfNeeded();
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
      viewRef.current = {
        scale: nextScale,
        tx: midX - worldX * nextScale,
        ty: midY - worldY * nextScale,
      };
      draw();
      return;
    }

    if (!pointer.moved) return;
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
    const elapsed = performance.now() - pointer.startedAt;
    if (!pointer.moved && !pointer.multi && elapsed <= TAP_TIME) {
      const position = eventPosition(event);
      handleTap(position.x, position.y);
    }
  }

  function handlePointerCancel(event: PointerEvent): void {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const remaining = [...pointersRef.current.values()][0];
    if (remaining) remaining.moved = true;
  }

  function handleWheel(event: WheelEvent): void {
    const graph = graphRef.current;
    if (!graph || graph.nodes.length === 0) return;
    event.preventDefault();
    autoFitRef.current = false;
    const position = eventPosition(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(position.x, position.y, Math.exp(-delta * 0.0015));
  }

  function handleWindowResize(): void {
    if (!syncCanvasSize()) return;
    draw();
    scheduleRelayout();
  }

  // ---- lifecycle: canvas sizing, native listeners, cleanup ----

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = media.matches;
    syncCanvasSize();
    if (graphRef.current) startLayout();
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
      startLayout();
    };
    media.addEventListener('change', handleMotionChange);

    // Theme switches only change tokens; redraw instead of rebuilding the graph.
    const themeObserver = new MutationObserver(() => {
      paletteThemeRef.current = '';
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
    };
  }, []);

  // Rebuild + re-layout only when note content or titles actually changed.
  useEffect(() => {
    const fingerprint = fingerprintNotes(notes);
    if (fingerprint === fingerprintRef.current && graphRef.current) return;
    fingerprintRef.current = fingerprint;
    graphRef.current = buildGraph(notes);
    layoutReadyRef.current = false;
    autoFitRef.current = true;
    startLayout();
  }, [notes]);

  // Active note highlight is a pure redraw (no simulation restart).
  useEffect(() => {
    draw();
  }, [activeNoteId]);

  return (
    <div className="graph-view" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="img"
        aria-label="关系图谱画布，可拖动平移、双指缩放，点击节点打开笔记"
      />
      {notes.length > 0 ? (
        <>
          <div className="graph-toolbar" role="toolbar" aria-label="图谱缩放">
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
              onClick={() => {
                autoFitRef.current = true;
                fitView();
                draw();
              }}
              aria-label="适应画布"
              title="适应画布"
            >
              <Icon name="fit" size={20} />
            </button>
            <button
              type="button"
              className="icon-btn graph-btn"
              onClick={() => {
                autoFitRef.current = true;
                startLayout();
              }}
              aria-label="重新布局"
              title="重新布局"
            >
              <Icon name="refresh" size={20} />
            </button>
          </div>
          <div className="graph-legend">🍡 越圆越大颗</div>
        </>
      ) : (
        <div className="empty graph-empty">
          <Mascot variant="sleepy" size={96} bob />
          <div className="empty-title">还没有麻薯可以串起来呀～</div>
          <div className="empty-text">先捏一颗笔记，再回来看看它们怎么连在一起</div>
        </div>
      )}
    </div>
  );
}
