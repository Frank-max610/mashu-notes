import type { Note, NoteSummary } from './types';
import { normalizeTitle, noteSummary } from './links';
import { excerpt, plainText } from './markdown';

/**
 * Search for Mochi.
 *
 * A vault is small (hundreds of notes) and lives in memory, so search is a
 * plain linear scan per keystroke rather than a maintained index. Everything
 * here is pure and DOM-free: the UI can call `searchNotes` from render without
 * any subscription or teardown, and the wiki-link autocomplete reuses the same
 * title-matching rules through `searchTitleIndex`.
 *
 * Query grammar:
 * - The query is split on whitespace.
 * - Tokens starting with `#` are tag filters and are matched against
 *   `note.tags` (case-insensitive; a stored tag may optionally keep its `#`).
 * - Every remaining token must appear in the title *or* the content
 *   (case-insensitive) — tokens are ANDed, so adding words narrows results.
 */

export interface SearchHit {
  id: string;
  title: string;
  score: number;
  snippet: string;
}

const DEFAULT_LIMIT = 30;
const TITLE_INDEX_LIMIT = 8;

/** Characters of context kept on each side of a body match in a snippet. */
const SNIPPET_CONTEXT = 40;
/** Characters of the plain-text body used as an idle (blank query) snippet. */
const IDLE_SNIPPET_LENGTH = 60;

const TITLE_EXACT_SCORE = 1000;
const TITLE_PREFIX_SCORE = 600;
const TITLE_CONTAINS_SCORE = 400;
const TAG_SCORE = 200;
const BODY_SCORE = 120;
const BODY_OCCURRENCE_SCORE = 10;
const BODY_OCCURRENCE_CAP = 10;

interface QueryTerms {
  /** Lower-cased tokens that must match title or content. */
  textTokens: string[];
  /** Lower-cased tag keys that must all be present in `note.tags`. */
  tagTokens: string[];
}

function parseQuery(query: string): QueryTerms {
  const textTokens: string[] = [];
  const tagTokens: string[] = [];
  for (const raw of query.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('#') && raw.length > 1) tagTokens.push(normalizeTagToken(raw));
    else textTokens.push(raw);
  }
  return { textTokens, tagTokens };
}

/** Tags are stored without `#`; tolerate both forms and ignore case. */
function normalizeTagToken(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase();
}

/** Normalise an optional result limit; `NaN` falls back to the default. */
function clampLimit(limit: number, fallback: number): number {
  const value = Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.max(0, value);
}

/** Higher is better: exact title, prefix, then substring. */
function titleRank(title: string, query: string): number {
  if (!query) return 0;
  if (title === query) return TITLE_EXACT_SCORE;
  if (title.startsWith(query)) return TITLE_PREFIX_SCORE;
  if (title.includes(query)) return TITLE_CONTAINS_SCORE;
  return 0;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

/**
 * Build a one-line snippet around the first body match of any text token.
 * Returns `''` when the body does not match (title/tag-only hit).
 */
function buildSnippet(body: string, textTokens: string[]): string {
  if (textTokens.length === 0 || !body) return '';
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const token of textTokens) {
    const index = lower.indexOf(token);
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = token.length;
    }
  }
  if (matchIndex === -1) return '';
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
  const end = Math.min(flat.length, matchIndex + matchLength + SNIPPET_CONTEXT);
  let snippet = flat.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < flat.length) snippet = `${snippet}…`;
  return snippet;
}

/**
 * Full-text search over a vault.
 *
 * Results are sorted by score, then by recency, then by input order so the
 * output is fully deterministic (a "stable" search is important for tests and
 * for a list that should not visibly reshuffle between keystrokes).
 */
export function searchNotes(notes: Note[], query: string, limit = DEFAULT_LIMIT): SearchHit[] {
  const max = clampLimit(limit, DEFAULT_LIMIT);
  if (max === 0) return [];

  const { textTokens, tagTokens } = parseQuery(query);
  const textQuery = textTokens.join(' ');

  // Blank query: behave like the "recently edited" list.
  if (textTokens.length === 0 && tagTokens.length === 0) {
    return notes
      .map((note, index) => ({ note, index }))
      .sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.index - b.index)
      .slice(0, max)
      .map(({ note }) => ({
        id: note.id,
        title: note.title,
        score: 0,
        snippet: excerpt(note.content, IDLE_SNIPPET_LENGTH),
      }));
  }

  interface RankedHit extends SearchHit {
    /** Original array position, the final deterministic tiebreaker. */
    index: number;
    updatedAt: number;
  }

  const ranked: RankedHit[] = [];

  notes.forEach((note, index) => {
    const normalizedTitle = normalizeTitle(note.title);

    if (tagTokens.length > 0) {
      const noteTags = new Set(note.tags.map(normalizeTagToken));
      if (!tagTokens.every((tag) => noteTags.has(tag))) return;
    }

    // Body matching runs on plain text so Markdown syntax and code do not
    // produce noisy hits or ugly snippets.
    const body = plainText(note.content);
    const bodyLower = body.toLowerCase();

    for (const token of textTokens) {
      if (!normalizedTitle.includes(token) && !bodyLower.includes(token)) return;
    }

    let score = tagTokens.length * TAG_SCORE;

    if (textTokens.length > 0) {
      // Reward the best title match: the full query first (so "react hooks"
      // ranks a note titled exactly that ahead of single-token hits), then
      // any individual token (a partial title still beats body-only).
      let bestTitle = titleRank(normalizedTitle, textQuery);
      for (const token of textTokens) {
        bestTitle = Math.max(bestTitle, titleRank(normalizedTitle, token));
      }
      score += bestTitle;

      for (const token of textTokens) {
        const occurrences = countOccurrences(bodyLower, token);
        if (occurrences > 0) {
          score += BODY_SCORE + BODY_OCCURRENCE_SCORE * Math.min(occurrences, BODY_OCCURRENCE_CAP);
        }
      }
    }

    ranked.push({
      id: note.id,
      title: note.title,
      score,
      snippet: buildSnippet(body, textTokens),
      index,
      updatedAt: note.updatedAt,
    });
  });

  ranked.sort(
    (a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.index - b.index,
  );

  return ranked.slice(0, max).map(({ id, title, score, snippet }) => ({
    id,
    title,
    score,
    snippet,
  }));
}

/** Rank for [[wiki-link]] autocomplete: exact title, prefix, then substring. */
function titleIndexRank(title: string, query: string): number {
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  return 2;
}

/**
 * Title-only lookup used by the `[[` autocomplete.
 *
 * Only notes whose title contains the query are returned; prefix matches come
 * before substring matches, and recency breaks ties inside each group. A blank
 * query returns the most recently updated notes so the picker opens useful.
 */
export function searchTitleIndex(
  notes: Note[],
  query: string,
  limit = TITLE_INDEX_LIMIT,
): NoteSummary[] {
  const max = clampLimit(limit, TITLE_INDEX_LIMIT);
  if (max === 0) return [];

  const entries = notes.map((note, index) => ({
    note,
    index,
    title: normalizeTitle(note.title),
  }));

  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) {
    return entries
      .sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.index - b.index)
      .slice(0, max)
      .map(({ note }) => noteSummary(note));
  }

  return entries
    .filter(({ title }) => title.includes(normalizedQuery))
    .sort(
      (a, b) =>
        titleIndexRank(a.title, normalizedQuery) - titleIndexRank(b.title, normalizedQuery) ||
        b.note.updatedAt - a.note.updatedAt ||
        a.index - b.index,
    )
    .slice(0, max)
    .map(({ note }) => noteSummary(note));
}
