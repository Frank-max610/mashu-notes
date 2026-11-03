import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../src/lib/types';
import { buildGraph, layoutSync, seedPositions, tick } from '../src/lib/graph';

function makeNote(id: string, title: string, content = ''): Note {
  return {
    id,
    title,
    content,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
  };
}

const WIDTH = 390;
const HEIGHT = 700;

/** A small vault with linked notes, a back-link and two dangling links. */
function sampleVault(): Note[] {
  return [
    makeNote('n1', '欢迎来到 Mochi', '[[Markdown 速查]] [[双向链接]] [[未来的笔记]]'),
    makeNote('n2', 'Markdown 速查', '[[欢迎来到 Mochi]]'),
    makeNote('n3', '双向链接', '[[未来的笔记]] [[缺失的笔记]]'),
    makeNote('n4', '关系图谱', ''),
  ];
}

describe('buildGraph', () => {
  it('creates one non-ghost node per note in vault order', () => {
    const graph = buildGraph(sampleVault());

    expect(graph.nodes.slice(0, 4).map((node) => node.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(graph.nodes.slice(0, 4).every((node) => node.ghost === false)).toBe(true);
    expect(graph.nodes.map((node) => node.title)).toEqual([
      '欢迎来到 Mochi',
      'Markdown 速查',
      '双向链接',
      '关系图谱',
      '未来的笔记',
      '缺失的笔记',
    ]);
  });

  it('resolves wiki links into edges between notes', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Beta]]'), makeNote('b', 'Beta')]);

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(graph.nodes.find((node) => node.id === 'a')?.degree).toBe(1);
    expect(graph.nodes.find((node) => node.id === 'b')?.degree).toBe(1);
  });

  it('resolves links case-insensitively and tolerates .md suffixes', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[beta]] [[Gamma.md]]'),
      makeNote('b', 'Beta'),
      makeNote('c', 'Gamma'),
    ]);

    expect(graph.edges).toEqual([
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ]);
    expect(graph.nodes.every((node) => node.ghost === false)).toBe(true);
  });

  it('turns dangling links into ghost nodes with ghost:<normalized title> ids', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Missing Note]]')]);
    const ghost = graph.nodes.find((node) => node.ghost);

    expect(graph.nodes).toHaveLength(2);
    expect(ghost).toBeDefined();
    expect(ghost?.id).toBe('ghost:missing note');
    expect(ghost?.title).toBe('Missing Note');
    expect(ghost?.degree).toBe(1);
    expect(graph.edges).toEqual([{ source: 'a', target: 'ghost:missing note' }]);
  });

  it('keeps the first raw spelling as the ghost title and dedupes case variants', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Future Idea]]'),
      makeNote('b', 'Beta', '[[future idea]] [[FUTURE   IDEA]]'),
    ]);
    const ghosts = graph.nodes.filter((node) => node.ghost);

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.id).toBe('ghost:future idea');
    expect(ghosts[0]?.title).toBe('Future Idea');
    expect(ghosts[0]?.degree).toBe(2);
    expect(graph.edges).toHaveLength(2);
  });

  it('dedupes repeated and reverse-direction links into one undirected edge', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Beta]] [[Beta]] [[beta|alias]]'),
      makeNote('b', 'Beta', '[[Alpha]]'),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ source: 'a', target: 'b' });
    expect(graph.nodes.find((node) => node.id === 'a')?.degree).toBe(1);
    expect(graph.nodes.find((node) => node.id === 'b')?.degree).toBe(1);
  });

  it('skips self links instead of creating a loop', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Alpha]] [[alpha]]')]);

    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0]?.degree).toBe(0);
  });

  it('computes degree as the number of unique incident edges', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '[[Hub]]'),
      makeNote('b', 'Beta', '[[Hub]] [[Alpha]]'),
      makeNote('c', 'Gamma', '[[Hub]]'),
      makeNote('h', 'Hub'),
    ]);
    const degree = new Map(graph.nodes.map((node) => [node.id, node.degree]));

    expect(graph.edges).toHaveLength(4);
    expect(degree.get('h')).toBe(3);
    expect(degree.get('b')).toBe(2);
    expect(degree.get('a')).toBe(2);
    expect(degree.get('c')).toBe(1);
  });

  it('ignores wiki links inside code spans / fences', () => {
    const graph = buildGraph([
      makeNote('a', 'Alpha', '```\n[[Beta]]\n```\n`[[Beta]]` [[Beta]]'),
      makeNote('b', 'Beta'),
    ]);

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
  });

  it('returns an empty graph for an empty vault', () => {
    expect(buildGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it('produces finite numbers with no NaN for isolated and linked notes', () => {
    const graph = buildGraph(sampleVault());
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.vx)).toBe(true);
      expect(Number.isFinite(node.vy)).toBe(true);
      expect(Number.isFinite(node.degree)).toBe(true);
    }
  });
});

describe('seedPositions', () => {
  it('is deterministic and stays inside the given bounds', () => {
    const first = buildGraph(sampleVault());
    const second = buildGraph(sampleVault());

    seedPositions(first, WIDTH, HEIGHT);
    seedPositions(second, WIDTH, HEIGHT);

    expect(second.nodes.map((node) => [node.x, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.y]),
    );
    for (const node of first.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(HEIGHT);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.vx).toBe(0);
      expect(node.vy).toBe(0);
    }
  });

  it('does not use randomness', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const graph = buildGraph(sampleVault());
    seedPositions(graph, WIDTH, HEIGHT);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('centers a single node', () => {
    const graph = buildGraph([makeNote('only', 'Only')]);
    seedPositions(graph, WIDTH, HEIGHT);

    expect(graph.nodes[0]?.x).toBe(WIDTH / 2);
    expect(graph.nodes[0]?.y).toBe(HEIGHT / 2);
  });

  it('handles an empty graph and degenerate sizes without throwing', () => {
    const empty = buildGraph([]);
    expect(() => seedPositions(empty, 0, 0)).not.toThrow();
    expect(empty.nodes).toHaveLength(0);

    const graph = buildGraph([makeNote('a', 'Alpha'), makeNote('b', 'Beta')]);
    expect(() => seedPositions(graph, 0, 0)).not.toThrow();
    expect(() => tick(graph, 0, 0)).not.toThrow();
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});

describe('tick', () => {
  it('keeps coordinates finite even for coincident nodes and degenerate sizes', () => {
    const graph = buildGraph([makeNote('a', 'Alpha'), makeNote('b', 'Beta')]);
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
      expect(Number.isFinite(node.vx)).toBe(true);
      expect(Number.isFinite(node.vy)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }
    expect(graph.nodes[0]?.x).not.toBe(graph.nodes[1]?.x);
  });

  it('moves linked nodes apart from a coincident start', () => {
    const graph = buildGraph([makeNote('a', 'Alpha', '[[Beta]]'), makeNote('b', 'Beta')]);
    for (const node of graph.nodes) {
      node.x = WIDTH / 2;
      node.y = HEIGHT / 2;
    }

    for (let i = 0; i < 60; i += 1) tick(graph, WIDTH, HEIGHT);
    const [a, b] = graph.nodes;
    const distance = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));

    expect(distance).toBeGreaterThan(10);
  });
});

describe('layoutSync', () => {
  it('produces finite, in-bounds, deterministic coordinates', () => {
    const first = layoutSync(buildGraph(sampleVault()), WIDTH, HEIGHT);
    const second = layoutSync(buildGraph(sampleVault()), WIDTH, HEIGHT);

    expect(second.nodes.map((node) => [node.x, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.y]),
    );

    for (const node of first.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.vx)).toBe(true);
      expect(Number.isFinite(node.vy)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it('spreads nodes apart instead of stacking them', () => {
    const graph = layoutSync(buildGraph(sampleVault()), WIDTH, HEIGHT);
    let minDistance = Infinity;
    for (let i = 0; i < graph.nodes.length; i += 1) {
      for (let j = i + 1; j < graph.nodes.length; j += 1) {
        const a = graph.nodes[i];
        const b = graph.nodes[j];
        if (!a || !b) continue;
        minDistance = Math.min(minDistance, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }

    expect(minDistance).toBeGreaterThan(8);
  });

  it('returns the same graph instance and no-ops on an empty vault', () => {
    const graph = buildGraph([]);
    const result = layoutSync(graph, WIDTH, HEIGHT);
    expect(result).toBe(graph);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
