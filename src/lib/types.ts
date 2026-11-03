/**
 * Core data model for Mashu.
 *
 * A vault is a flat set of notes plus optional life records (food, health,
 * finance, diary). Relations are derived from Markdown (`[[wiki links]]`,
 * `#tags`) or from structured metadata (same-day life records), and users can
 * also draw manual links by hand. Everything stays portable.
 */

/** What a note represents in the life log. */
export type NoteKind = 'note' | 'diary' | 'food' | 'health' | 'finance';

export type MealSlot = '早餐' | '午餐' | '晚餐' | '加餐' | '夜宵' | '未分类';

export type HealthMetric =
  | '体重'
  | '睡眠'
  | '步数'
  | '心率'
  | '饮水'
  | '运动'
  | '活动能量'
  | '心情'
  | '其他';

export type FinanceDirection = 'expense' | 'income';

/** Structured fields attached to a record. All optional and extensible. */
export interface NoteMeta {
  /** When the record happened (defaults to the note timestamp). */
  occurredAt?: number;
  /** Food. */
  meal?: MealSlot;
  calories?: number;
  dishes?: string[];
  /** Health. */
  metric?: HealthMetric;
  value?: number;
  unit?: string;
  mood?: string;
  /** Finance (amount is also used for food spend). */
  amount?: number;
  category?: string;
  direction?: FinanceDirection;
  /** Free-form extra note from the agent parser. */
  detail?: string;
}

/** Saved graph position, normalised to 0..1 so it survives resizing. */
export interface NotePosition {
  x: number;
  y: number;
}

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
  /** Life-record type; legacy notes default to `note`. */
  kind: NoteKind;
  /** Structured fields for life records. */
  meta: NoteMeta;
  /** Note ids the user linked by hand (in addition to `[[wiki links]]`). */
  manualLinks: string[];
  /** Optional saved graph position (normalised 0..1). */
  position?: NotePosition;
}

/** Lightweight note projection used by lists, graphs and search results. */
export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  updatedAt: number;
  pinned: boolean;
  kind: NoteKind;
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

/** Editable fields of a note. */
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'kind' | 'meta'>>;

/** Input for creating a note (from the editor, quick capture or the agent). */
export interface NoteInput {
  title?: string;
  content?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  position?: NotePosition;
}

/** Draft produced by the local agent / quick capture before it is saved. */
export interface RecordDraft {
  kind: NoteKind;
  title: string;
  content: string;
  meta: NoteMeta;
  confidence: number;
}

/** Agent persona — the user can rename and re-avatar the built-in agent. */
export interface AgentPersona {
  name: string;
  /** Preset avatar key (`mochi`, `cat`, `leaf`, ... ) or a custom emoji. */
  avatar: string;
}

export type ThemeMode = 'dark' | 'light' | 'system';
