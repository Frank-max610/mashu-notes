/**
 * Core data model for Inkstone.
 *
 * A vault is just a flat set of notes. Relations are derived from note content
 * (`[[wiki links]]` and `#tags`), never stored separately — that keeps the data
 * portable and makes every feature (backlinks, graph, search) a pure function.
 */

export interface Note {
  /** Stable unique id (uuid). */
  id: string;
  /** Human readable title, also the anchor for [[wiki links]]. */
  title: string;
  /** Markdown body. Titles live in `title`; headings may appear here too. */
  content: string;
  /** Derived `#tags` from `content`, kept in sync on every save. */
  tags: string[];
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Pinned notes sort first. */
  pinned: boolean;
}

/** Lightweight note projection used by lists, graphs and search results. */
export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  updatedAt: number;
  pinned: boolean;
}

/** A parsed `[[target|alias]]` occurrence. */
export interface WikiLink {
  /** Raw link target, trimmed. */
  target: string;
  /** Optional display text. */
  alias: string | null;
}

/** A wiki link in a note, resolved against the vault if possible. */
export interface ResolvedLink {
  target: string;
  alias: string | null;
  /** Matching note, or null for a dangling link. */
  note: NoteSummary | null;
}

/** A note that links to the current one. */
export interface Backlink {
  note: NoteSummary;
  /** How many times the source note links to the target. */
  count: number;
}

/** Tag with usage count, used by filter chips. */
export interface TagCount {
  /** Lower-cased grouping key. */
  tag: string;
  /** Display form as first seen. */
  label: string;
  count: number;
}

export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned'>>;

export type ThemeMode = 'dark' | 'light' | 'system';
