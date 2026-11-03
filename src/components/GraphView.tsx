import { useEffect, useRef } from 'react';
import type { Note } from '../lib/types';
import { buildGraph, layoutSync, seedPositions, tick } from '../lib/graph';
import type { Graph, GraphNode } from '../lib/graph';
import { Icon } from './Icon';
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

interface Palette {
  bg: string;
  node: string;
  ghost: string;
  edge: string;
  accent: string;
  text: string;
  textMuted: string;
  textFaint: string;
  fontSans: string;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
const TAP_SLOP = 8;
const TAP_TIME = 350;
const DEFAULT_TICK_BUDGET = 160;
const TICKS_PER_FRAME = 2;
const LABEL_FONT_SIZE = 11;
const MAX_LABEL_CHARS = 14;
const FALLBACK_PALETTE: Palette = {
  bg: '#0e0e12',
  node: '#a78bfa',
  ghost: '#5b5b6b',
  edge: 'rgba(167, 139, 250, 0.28)',
  accent: '#a78bfa',
  text: '#ececf2',
  textMuted: '#9b9baa',
  textFaint: '#6b6b7b',
  fontSans: 'system-ui, sans-serif',
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
function nodeRadius(node: GraphNode): number {
  return 4 + Math.sqrt(Math.max(0, node.degree)) * 1.8;
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
    const theme = document.documentElement.getAttribute('data-theme') ?? 'dark';
    const cached = paletteRef.current;
    if (cached && paletteThemeRef.current === theme) return cached;
    if (!container) return FALLBACK_PALETTE;
    const styles = getComputedStyle(container);
    const read = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    const palette: Palette = {
      bg: read('--bg', FALLBACK_PALETTE.bg),
      node: read('--graph-node', FALLBACK_PALETTE.node),
      ghost: read('--graph-node-ghost', FALLBACK_PALETTE.ghost),
      edge: read('--graph-edge', FALLBACK_PALETTE.edge),
      accent: read('--accent', FALLBACK_PALETTE.accent),
      text: read('--text', FALLBACK_PALETTE.text),
      textMuted: read('--text-muted', FALLBACK_PALETTE.textMuted),
      textFaint: read('--text-faint', FALLBACK_PALETTE.textFaint),
      fontSans: read('--font-sans', FALLBACK_PALETTE.fontSans),
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

    // ---- edges (world space) ----
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    const hairline = 1 / view.scale;
    context.lineWidth = hairline;
    context.strokeStyle = palette.edge;
    context.beginPath();
    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
    }
    context.stroke();

    // Edges touching the active note get a brighter accent pass.
    if (activeId) {
      context.globalAlpha = 0.55;
      context.strokeStyle = palette.accent;
      context.lineWidth = 1.6 / view.scale;
      context.beginPath();
      for (const edge of graph.edges) {
        if (edge.source !== activeId && edge.target !== activeId) continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
      }
      context.stroke();
      context.globalAlpha = 1;
    }

    // ---- nodes (world space) ----
    for (const node of graph.nodes) {
      const radius = nodeRadius(node);
      const isActive = node.id === activeId;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      if (node.ghost) {
        context.fillStyle = palette.bg;
        context.fill();
        context.setLineDash([3 / view.scale, 3 / view.scale]);
        context.lineWidth = 1.5 / view.scale;
        context.strokeStyle = palette.ghost;
        context.stroke();
        context.setLineDash([]);
      } else {
        context.fillStyle = isActive ? palette.accent : palette.node;
        context.fill();
      }
      if (isActive) {
        context.beginPath();
        context.arc(node.x, node.y, radius + 4 / view.scale, 0, Math.PI * 2);
        context.globalAlpha = 0.4;
        context.lineWidth = 3 / view.scale;
        context.strokeStyle = palette.accent;
        context.stroke();
        context.globalAlpha = 1;
      }
    }

    // ---- labels (screen space, so text stays crisp at any zoom) ----
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

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.font = `500 ${LABEL_FONT_SIZE}px ${palette.fontSans}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const takenLabelAreas: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const node of bySignificance) {
      if (!labelled.has(node.id)) continue;
      const label = truncateLabel(node.title);
      if (!label) continue;
      const screenX = node.x * view.scale + view.tx;
      const screenY = node.y * view.scale + view.ty;
      const radius = nodeRadius(node) * view.scale;
      if (screenX < -120 || screenX > width + 120 || screenY < -40 || screenY > height + 40) {
        continue;
      }
      const isActive = node.id === activeId;
      const textWidth = context.measureText(label).width;
      // Keep labels inside the canvas and below/above the node, whatever the zoom.
      const labelX = clamp(screenX, textWidth / 2 + 6, width - textWidth / 2 - 6);
      let labelY = screenY + radius + 11;
      if (labelY > height - 10) labelY = screenY - radius - 11;
      if (!isActive) {
        const overlaps = takenLabelAreas.some(
          (area) =>
            labelX - textWidth / 2 < area.right + 3 &&
            labelX + textWidth / 2 > area.left - 3 &&
            labelY + 7 > area.top - 3 &&
            labelY - 7 < area.bottom + 3,
        );
        if (overlaps) continue;
      }
      takenLabelAreas.push({
        left: labelX - textWidth / 2,
        right: labelX + textWidth / 2,
        top: labelY - 7,
        bottom: labelY + 7,
      });
      context.fillStyle = isActive
        ? palette.text
        : node.ghost
          ? palette.textFaint
          : palette.textMuted;
      context.fillText(label, labelX, labelY);
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
          <div className="graph-legend">节点越大 = 被引用越多</div>
        </>
      ) : (
        <div className="empty graph-empty">
          <Icon name="graph" size={30} />
          <div className="empty-title">还没有笔记</div>
          <div className="empty-text">
            写下第一条笔记后，这里会用连线展示笔记之间的 [[双向链接]]。
          </div>
        </div>
      )}
    </div>
  );
}
