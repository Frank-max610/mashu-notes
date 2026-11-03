import type { Backlink, Note, NoteSummary, ResolvedLink, TagCount, WikiLink } from './types';

/**
 * Link + tag parsing utilities.
 *
 * Every relation in Rixin is derived from plain Markdown. These helpers are
 * deliberately dependency-free and synchronous so they can run on every
 * keystroke, and they ignore code spans/blocks so `[[not a link]]` inside a
 * fenced block stays prose.
 */

/** Replace code spans and fenced blocks with spaces (same length, newlines kept). */
export function maskCode(content: string): string {
  const fence = /(^|\n)(\s*)(```|~~~)[^\n]*\n[\s\S]*?\n\s*\3[^\n]*(\n|$)/g;
  let masked = content.replace(fence, (match) => match.replace(/[^\n]/g, ' '));
  // An unclosed fence swallows the rest of the document while the user types.
  masked = masked.replace(/(^|\n)([ \t]*)(```|~~~)[^\n]*\n[\s\S]*$/g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
  masked = masked.replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
  return masked;
}

export function noteSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    updatedAt: note.updatedAt,
    pinned: note.pinned,
    kind: note.kind ?? 'note',
  };
}

/** Trim + collapse whitespace + lower-case, for tolerant title matching. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Target may not contain `|`; the alias part is optional and may be empty,
// so `[[note|]]` still links to "note".
const WIKI_LINK_RE = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g;

/** Parse all `[[target]]` / `[[target|alias]]` occurrences. */
export function extractWikiLinks(content: string): WikiLink[] {
  const masked = maskCode(content);
  const links: WikiLink[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(masked)) !== null) {
    const target = match[1].trim();
    if (!target) continue;
    const alias = match[2]?.trim() || null;
    links.push({ target, alias });
  }
  return links;
}

// A tag starts with `#` (not part of a word/URL) and contains letters, numbers,
// CJK, `_`, `-`, `/`. Purely numeric tags are rejected (same rule as Obsidian).
const TAG_RE = /(^|[\s([{（【「，。、;；:：!！?？])#([\p{L}\p{N}_\-/]+)/gu;
const NUMERIC_TAG_RE = /^\d+$/;

/** Parse all inline `#tags`, de-duplicated case-insensitively. */
export function extractTags(content: string): string[] {
  const masked = maskCode(content);
  const seen = new Set<string>();
  const tags: string[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(masked)) !== null) {
    const tag = match[2];
    if (!tag || NUMERIC_TAG_RE.test(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

/** Build a case-insensitive title → note index. */
export function buildTitleIndex(notes: Note[]): Map<string, NoteSummary> {
  const index = new Map<string, NoteSummary>();
  for (const note of notes) {
    const key = normalizeTitle(note.title);
    if (!key) continue;
    const existing = index.get(key);
    if (!existing || note.updatedAt > existing.updatedAt) {
      index.set(key, noteSummary(note));
    }
  }
  return index;
}

/** Resolve a wiki-link target to a note, tolerating `.md` suffixes. */
export function resolveLink(
  target: string,
  index: Map<string, NoteSummary>,
): NoteSummary | undefined {
  const direct = index.get(normalizeTitle(target));
  if (direct) return direct;
  const withoutExt = target.replace(/\.md$/i, '');
  return index.get(normalizeTitle(withoutExt));
}

/** Wiki links leaving this note, de-duplicated by target. */
export function outgoingLinks(note: Note, notes: Note[]): ResolvedLink[] {
  const index = buildTitleIndex(notes);
  const seen = new Set<string>();
  const result: ResolvedLink[] = [];
  for (const link of extractWikiLinks(note.content)) {
    const key = normalizeTitle(link.target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      target: link.target,
      alias: link.alias,
      note: resolveLink(link.target, index) ?? null,
    });
  }
  return result;
}

/** Notes linking to `note`, sorted by link count then recency. */
export function backlinksFor(note: Note, notes: Note[]): Backlink[] {
  const targetKey = normalizeTitle(note.title);
  if (!targetKey) return [];
  const result: Backlink[] = [];
  for (const other of notes) {
    if (other.id === note.id) continue;
    let count = 0;
    for (const link of extractWikiLinks(other.content)) {
      if (normalizeTitle(link.target) === targetKey) count += 1;
    }
    if (count > 0) result.push({ note: noteSummary(other), count });
  }
  return result.sort((a, b) => b.count - a.count || b.note.updatedAt - a.note.updatedAt);
}

/** Count how many notes link to each note (used by the graph view). */
export function backlinkCounts(notes: Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  const index = buildTitleIndex(notes);
  for (const note of notes) {
    for (const link of extractWikiLinks(note.content)) {
      const resolved = resolveLink(link.target, index);
      if (!resolved) continue;
      counts.set(resolved.id, (counts.get(resolved.id) ?? 0) + 1);
    }
  }
  return counts;
}

/** All tags in the vault with usage counts, most used first. */
export function allTags(notes: Note[]): TagCount[] {
  const groups = new Map<string, TagCount>();
  for (const note of notes) {
    for (const raw of note.tags) {
      const key = raw.toLowerCase();
      const entry = groups.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        groups.set(key, { tag: key, label: raw, count: 1 });
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** True when the note mentions `query` in title or body (case-insensitive). */
export function noteMatches(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q);
}
