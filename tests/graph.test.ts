import { describe, expect, it, vi } from 'vitest';
import type { Note, NoteKind, NoteMeta, NotePosition } from '../src/lib/types';
import { buildGraph, layoutSync, seedPositions, tick, type GraphEdge } from '../src/lib/graph';

const WIDTH = 390;
const HEIGHT = 700;

interface NoteOptions {
  kind?: NoteKind;
  occurredAt?: number;
  createdAt?: number;
  manualLinks?: string[];
  position?: NotePosition;
}

function makeNote(id: string, title: string, content = '', options: NoteOptions = {}): Note {
  const timestamp = options.occurredAt ?? options.createdAt ?? 0;
  const meta: NoteMeta = options.occurredAt === undefined ? {} : { occurredAt: options.occurredAt };
  const note: Note = {
    id,
    title,
    content,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    kind: options.kind ?? 'note',
    meta,
    manualLinks: options.manualLinks ?? [],
  };
  if (options.position) note.position = options.position;
  return note;
}

/** Local-time timestamp so day grouping is timezone-independent. */
function at(day: number, hour: number): number {
  return new Date(2026, 2, day, hour, 0, 0, 0).getTime();
}

function findEdge(edges: GraphEdge[], a: string, b: string): GraphEdge | undefined {
  return edges.find(
    (edge) => (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a),
  );
}

function degreeOf(graph: ReturnType<typeof buildGraph>, id: string): number {
  return graph.nodes.find((node) => node.id === id)?.degree ?? -1;
}

describe('buildGraph — nodes and wiki edges', () => {
  it('copies each note kind onto its node and keeps ghosts as plain notes', () => {
    const graph = buildGraph([
      makeNote('food', '早餐', '[[未来的一餐]]', { kind: 'food' }),
      makeNote('plain', '普通笔记'),
    ]);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(byId.get('food')?.kind).toBe('food');
    expect(byId.get('food')?.ghost).toBe(false);
    expect(byId.get('plain')?.kind).toBe('note');
    expect(byId.get('ghost:未来的一餐')).toMatchObject({ ghost: true, kind: 'note' });
  });

  it('creates typed, deduped wiki edges and skips self links', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]] [[beta]] [[Alpha]]'),
      makeNote('b', 'Beta', '[[Alpha]]'),
    ]);

    expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'wiki' }]);
    expect(degreeOf(graph, 'a')).toBe(1);
    expect(degreeOf(graph, 'b')).toBe(1);
  });

  it('turns dangling wiki links into ghost nodes with wiki edges', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Missing Note]]')]);
    const ghost = graph.nodes.find((node) => node.ghost);

    expect(ghost).toMatchObject({ id: 'ghost:missing note', title: 'Missing Note', degree: 1 });
    expect(graph.edges).toEqual([{ source: 'a', target: 'ghost:missing note', type: 'wiki' }]);
  });
});

describe('buildGraph — manual edges', () => {
  it('creates manual edges from note.manualLinks resolved by note id', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '', { manualLinks: ['b'] }),
      makeNote('b', 'Beta'),
    ]);

    expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'manual' }]);
    expect(degreeOf(graph, 'a')).toBe(1);
    expect(degreeOf(graph, 'b')).toBe(1);
  });

  it('skips dangling and self manual links', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '', { manualLinks: ['missing', 'a', 'b'] }),
      makeNote('b', 'Beta'),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'a', target: 'b', type: 'manual' });
  });

  it('dedupes manual links across both directions', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '', { manualLinks: ['b'] }),
      makeNote('b', 'Beta', '', { manualLinks: ['a'] }),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.type).toBe('manual');
    expect(degreeOf(graph, 'a')).toBe(1);
    expect(degreeOf(graph, 'b')).toBe(1);
  });

  it('lets a manual link win over a parallel wiki link', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]]', { manualLinks: ['b'] }),
      makeNote('b', 'Beta'),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'a', target: 'b', type: 'manual' });
  });

  it('lets a manual link on either note upgrade a wiki edge', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]]'),
      makeNote('b', 'Beta', '', { manualLinks: ['a'] }),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.type).toBe('manual');
  });
});

describe('buildGraph — day chains', () => {
  it('chains same-day life records consecutively in chronological order', () => {
    const graph = buildGraph([
      makeNote('d3', '步数', '', { kind: 'health', occurredAt: at(5, 10) }),
      makeNote('d1', '早餐', '', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('d4', '心情', '', { kind: 'diary', occurredAt: at(5, 11) }),
      makeNote('d2', '咖啡', '', { kind: 'finance', occurredAt: at(5, 9) }),
    ]);
    const dayEdges = graph.edges.filter((edge) => edge.type === 'day');

    expect(dayEdges).toHaveLength(3);
    expect(findEdge(dayEdges, 'd1', 'd2')).toBeDefined();
    expect(findEdge(dayEdges, 'd2', 'd3')).toBeDefined();
    expect(findEdge(dayEdges, 'd3', 'd4')).toBeDefined();
    // Consecutive only: no chords between non-neighbours.
    expect(findEdge(dayEdges, 'd1', 'd3')).toBeUndefined();
    expect(findEdge(dayEdges, 'd1', 'd4')).toBeUndefined();
    expect(findEdge(dayEdges, 'd2', 'd4')).toBeUndefined();
  });

  it('does not chain plain notes even when they share a day', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '', { occurredAt: at(5, 8) }),
      makeNote('b', 'Beta', '', { occurredAt: at(5, 9) }),
    ]);

    expect(graph.edges).toHaveLength(0);
  });

  it('keeps different local days in separate chains', () => {
    const graph = buildGraph([
      makeNote('a1', '早餐', '', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('a2', '午餐', '', { kind: 'food', occurredAt: at(5, 12) }),
      makeNote('b1', '早餐', '', { kind: 'food', occurredAt: at(6, 8) }),
      makeNote('b2', '午餐', '', { kind: 'food', occurredAt: at(6, 12) }),
    ]);
    const dayEdges = graph.edges.filter((edge) => edge.type === 'day');

    expect(dayEdges).toHaveLength(2);
    expect(findEdge(dayEdges, 'a1', 'a2')).toBeDefined();
    expect(findEdge(dayEdges, 'b1', 'b2')).toBeDefined();
    expect(findEdge(dayEdges, 'a2', 'b1')).toBeUndefined();
  });

  it('falls back to createdAt when occurredAt is missing', () => {
    const graph = buildGraph([
      makeNote('a', '早餐', '', { kind: 'food', createdAt: at(5, 8) }),
      makeNote('b', '午餐', '', { kind: 'food', createdAt: at(5, 12) }),
    ]);

    expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'day' }]);
  });

  it('never duplicates a pair that is already a wiki or manual edge', () => {
    const graph = buildGraph([
      makeNote('a', '早餐', '[[午餐]]', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('b', '午餐', '', { kind: 'food', occurredAt: at(5, 12) }),
      makeNote('c', '咖啡', '', { kind: 'finance', occurredAt: at(5, 15), manualLinks: ['a'] }),
    ]);
    const dayEdges = graph.edges.filter((edge) => edge.type === 'day');

    expect(findEdge(graph.edges, 'a', 'b')?.type).toBe('wiki');
    expect(findEdge(graph.edges, 'a', 'c')?.type).toBe('manual');
    // b→c has no existing pair, so the day chain links it.
    expect(dayEdges).toHaveLength(1);
    expect(findEdge(dayEdges, 'b', 'c')).toBeDefined();
  });
});

describe('buildGraph — degree, ghosts, determinism', () => {
  it('counts every unique incident edge type in degree', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Bob]]'),
      makeNote('b', 'Bob'),
      makeNote('c', 'Carol'),
      makeNote('l1', '早餐', '', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('l2', '午餐', '', { kind: 'food', occurredAt: at(5, 12) }),
    ]);
    const withManual = buildGraph([
      makeNote('a', 'Alpha', '[[Bob]]', { manualLinks: ['c'] }),
      makeNote('b', 'Bob'),
      makeNote('c', 'Carol'),
    ]);

    expect(degreeOf(graph, 'l1')).toBe(1);
    expect(degreeOf(graph, 'l2')).toBe(1);
    expect(degreeOf(withManual, 'a')).toBe(2);
    expect(degreeOf(withManual, 'b')).toBe(1);
    expect(degreeOf(withManual, 'c')).toBe(1);
  });

  it('is deterministic and leaves finite numbers on every node', () => {
    const notes = [
      makeNote('a', 'Alpha', '[[Beta]] [[Missing]]', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('b', 'Beta', '', { kind: 'health', occurredAt: at(5, 9) }),
    ];
    const first = buildGraph(notes);
    const second = buildGraph(notes);

    expect(second).toEqual(first);
    for (const node of first.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.degree)).toBe(true);
    }
  });

  it('returns an empty graph for an empty vault', () => {
    expect(buildGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('seedPositions', () => {
  it('pins saved positions (0..1 mapped to canvas pixels) and marks them fixed', () => {
    const graph = buildGraph([
      makeNote('saved', 'Saved', '', { position: { x: 0.3, y: 0.6 } }),
      makeNote('free', 'Free'),
    ]);
    const saved = graph.nodes.find((node) => node.id === 'saved');
    const free = graph.nodes.find((node) => node.id === 'free');

    expect(saved?.fixed).toBe(true);
    expect(free?.fixed).toBe(false);

    seedPositions(graph, WIDTH, HEIGHT);

    expect(saved?.x).toBeCloseTo(0.3 * WIDTH, 6);
    expect(saved?.y).toBeCloseTo(0.6 * HEIGHT, 6);
    expect(saved?.vx).toBe(0);
    expect(saved?.vy).toBe(0);
  });

  it('clamps out-of-range saved positions into the canvas', () => {
    const graph = buildGraph([makeNote('saved', 'Saved', '', { position: { x: -5, y: 2 } })]);
    seedPositions(graph, WIDTH, HEIGHT);

    const node = graph.nodes[0];
    expect(node?.fixed).toBe(true);
    expect(node?.x).toBeGreaterThanOrEqual(0);
    expect(node?.x).toBeLessThanOrEqual(WIDTH);
    expect(node?.y).toBeGreaterThanOrEqual(0);
    expect(node?.y).toBeLessThanOrEqual(HEIGHT);
  });

  it('is deterministic and keeps free nodes inside the bounds', () => {
    const first = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]]'),
      makeNote('b', 'Beta'),
      makeNote('c', 'Carol'),
    ]);
    const second = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]]'),
      makeNote('b', 'Beta'),
      makeNote('c', 'Carol'),
    ]);

    seedPositions(first, WIDTH, HEIGHT);
    seedPositions(second, WIDTH, HEIGHT);

    expect(second.nodes.map((node) => [node.x, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.y]),
    );
    for (const node of first.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it('does not use randomness', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const graph = buildGraph([makeNote('a', 'Alpha'), makeNote('b', 'Beta')]);
    seedPositions(graph, WIDTH, HEIGHT);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('handles empty graphs and degenerate sizes', () => {
    const empty = buildGraph([]);
    expect(() => seedPositions(empty, 0, 0)).not.toThrow();
    expect(empty.nodes).toHaveLength(0);

    const graph = buildGraph([makeNote('a', 'Alpha'), makeNote('b', 'Beta')]);
    expect(() => seedPositions(graph, 0, 0)).not.toThrow();
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});

describe('tick / layoutSync — fixed positions', () => {
  it('never moves fixed nodes while the rest of the graph settles', () => {
    const graph = buildGraph([
      makeNote('pinned', 'Pinned', '', { position: { x: 0.3, y: 0.6 } }),
      makeNote('a', 'Alpha', '[[Beta]]'),
      makeNote('b', 'Beta'),
      makeNote('c', 'Carol'),
    ]);
    seedPositions(graph, WIDTH, HEIGHT);
    const pinned = graph.nodes.find((node) => node.id === 'pinned');
    const startX = pinned?.x ?? 0;
    const startY = pinned?.y ?? 0;
    const freeStart = new Map(
      graph.nodes.filter((node) => !node.fixed).map((node) => [node.id, { x: node.x, y: node.y }]),
    );

    for (let i = 0; i < 200; i += 1) tick(graph, WIDTH, HEIGHT);

    expect(pinned?.x).toBeCloseTo(startX, 6);
    expect(pinned?.y).toBeCloseTo(startY, 6);
    expect(pinned?.vx).toBe(0);
    expect(pinned?.vy).toBe(0);
    const freeMoved = graph.nodes.some((node) => {
      if (node.fixed) return false;
      const start = freeStart.get(node.id);
      return start ? Math.hypot(node.x - start.x, node.y - start.y) > 1 : false;
    });
    expect(freeMoved).toBe(true);
  });

  it('keeps fixed positions through layoutSync and stays deterministic', () => {
    const notes = [
      makeNote('pinned', 'Pinned', '', { position: { x: 0.25, y: 0.75 } }),
      makeNote('a', 'Alpha', '[[Beta]]', { kind: 'food', occurredAt: at(5, 8) }),
      makeNote('b', 'Beta', '', { kind: 'food', occurredAt: at(5, 9) }),
      makeNote('ghosty', 'Ghosty', '[[Missing]]'),
    ];
    const first = layoutSync(buildGraph(notes), WIDTH, HEIGHT, 150);
    const second = layoutSync(buildGraph(notes), WIDTH, HEIGHT, 150);

    expect(second.nodes.map((node) => [node.x, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.y]),
    );
    const pinned = first.nodes.find((node) => node.id === 'pinned');
    expect(pinned?.x).toBeCloseTo(0.25 * WIDTH, 6);
    expect(pinned?.y).toBeCloseTo(0.75 * HEIGHT, 6);

    for (const node of first.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it('keeps coincident nodes finite and apart on degenerate sizes', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Beta]]'), makeNote('b', 'Beta')]);
    for (const node of graph.nodes) {
      node.x = 0;
      node.y = 0;
      node.vx = 0;
      node.vy = 0;
    }

    for (let i = 0; i < 30; i += 1) tick(graph, 0, 0);

    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }
    expect(graph.nodes[0]?.x).not.toBe(graph.nodes[1]?.x);
  });

  it('no-ops safely on an empty graph', () => {
    const graph = buildGraph([]);
    expect(() => tick(graph, WIDTH, HEIGHT)).not.toThrow();
    expect(layoutSync(graph, WIDTH, HEIGHT)).toBe(graph);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
