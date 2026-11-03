import type { AgentPersona, Note, NoteInput, NoteMeta, NotePosition } from './types';
import { isNoteKind, HEALTH_METRICS, MEAL_SLOTS, FINANCE_CATEGORIES } from './kinds';
import { extractTags } from './links';

/** Simple client-side preference storage (theme, onboarding flag). */

const THEME_KEY = 'mochi.theme.v1';
const ONBOARDED_KEY = 'mochi.onboarded.v1';

const LEGACY_THEME_KEY = 'inkstone.theme.v1';
const LEGACY_ONBOARDED_KEY = 'inkstone.onboarded.v1';

export function getStoredTheme(): 'dark' | 'light' | 'system' {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
    // 0.1.x upgrade: adopt the old preference synchronously, before first paint.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'dark' || legacy === 'light' || legacy === 'system') {
      localStorage.setItem(THEME_KEY, legacy);
      localStorage.removeItem(LEGACY_THEME_KEY);
      return legacy;
    }
  } catch {
    /* ignore */
  }
  return 'light';
}

export function setStoredTheme(theme: 'dark' | 'light' | 'system'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function hasOnboarded(): boolean {
  try {
    if (localStorage.getItem(ONBOARDED_KEY) === '1') return true;
    // 0.1.x upgrade: honour the old flag so seeding does not duplicate notes.
    if (localStorage.getItem(LEGACY_ONBOARDED_KEY) === '1') {
      localStorage.setItem(ONBOARDED_KEY, '1');
      localStorage.removeItem(LEGACY_ONBOARDED_KEY);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function makeId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Clamp a normalised graph position into 0..1. */
function normalizePosition(value: unknown): NotePosition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Coerce arbitrary stored/imported data into a safe Note. */
function normalizeMeta(raw: unknown): NoteMeta {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const meta: NoteMeta = {};
  const occurredAt = finiteNumber(value.occurredAt);
  if (occurredAt !== undefined) meta.occurredAt = occurredAt;
  if (typeof value.meal === 'string' && (MEAL_SLOTS as readonly string[]).includes(value.meal)) {
    meta.meal = value.meal as NoteMeta['meal'];
  }
  const calories = finiteNumber(value.calories);
  if (calories !== undefined) meta.calories = Math.max(0, calories);
  if (Array.isArray(value.dishes)) {
    meta.dishes = value.dishes.filter((dish): dish is string => typeof dish === 'string' && dish.trim().length > 0);
  }
  if (typeof value.metric === 'string' && (HEALTH_METRICS as readonly string[]).includes(value.metric)) {
    meta.metric = value.metric as NoteMeta['metric'];
  }
  const metricValue = finiteNumber(value.value);
  if (metricValue !== undefined) meta.value = metricValue;
  if (typeof value.unit === 'string') meta.unit = value.unit;
  if (typeof value.mood === 'string') meta.mood = value.mood;
  const amount = finiteNumber(value.amount);
  if (amount !== undefined) meta.amount = Math.max(0, amount);
  if (typeof value.category === 'string') meta.category = value.category;
  if (value.direction === 'expense' || value.direction === 'income') meta.direction = value.direction;
  if (typeof value.detail === 'string') meta.detail = value.detail;
  return meta;
}

/**
 * Normalise a note coming from IndexedDB, localStorage or an imported file.
 * Missing life-record fields simply default to the legacy `note` shape.
 */
export function normalizeNote(raw: unknown, seenIds?: Set<string>): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const content = typeof value.content === 'string' ? value.content : '';
  const title =
    typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名笔记';
  let id = typeof value.id === 'string' && value.id ? value.id : makeId();
  if (seenIds) {
    if (seenIds.has(id)) id = makeId();
    seenIds.add(id);
  }
  const now = Date.now();
  const createdAt = finiteNumber(value.createdAt) ?? now;
  const updatedAt = finiteNumber(value.updatedAt) ?? createdAt;
  const manualLinks = Array.isArray(value.manualLinks)
    ? [...new Set(value.manualLinks.filter((link): link is string => typeof link === 'string' && link.length > 0))]
    : [];
  return {
    id,
    title,
    content,
    tags: extractTags(content),
    createdAt,
    updatedAt,
    pinned: value.pinned === true,
    kind: isNoteKind(value.kind) ? value.kind : 'note',
    meta: normalizeMeta(value.meta),
    manualLinks,
    position: normalizePosition(value.position),
  };
}

/** Create a brand-new note object. */
export function makeNote(input: NoteInput = {}): Note {
  const now = Date.now();
  const content = input.content ?? '';
  return {
    id: makeId(),
    title: input.title?.trim() || '未命名笔记',
    content,
    tags: extractTags(content),
    createdAt: now,
    updatedAt: now,
    pinned: false,
    kind: isNoteKind(input.kind) ? input.kind : 'note',
    meta: normalizeMeta(input.meta),
    manualLinks: [],
    position: normalizePosition(input.position),
  };
}

/* ---------------- agent persona ---------------- */

const AGENT_KEY = 'mochi.agent.v1';

export interface AgentAvatarOption {
  id: string;
  label: string;
  emoji: string;
}

export const AGENT_AVATARS: readonly AgentAvatarOption[] = [
  { id: 'mochi', label: '麻薯', emoji: '🍡' },
  { id: 'cat', label: '猫猫', emoji: '🐱' },
  { id: 'leaf', label: '叶子', emoji: '🌿' },
  { id: 'sun', label: '太阳', emoji: '☀️' },
  { id: 'star', label: '星星', emoji: '⭐' },
  { id: 'book', label: '书本', emoji: '📖' },
  { id: 'tea', label: '茶茶', emoji: '🍵' },
  { id: 'bowl', label: '饭碗', emoji: '🍚' },
];

export const DEFAULT_AGENT_PERSONA: AgentPersona = { name: '小麻薯', avatar: 'mochi' };

export function getAgentPersona(): AgentPersona {
  try {
    const raw = localStorage.getItem(AGENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AgentPersona>;
      const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : DEFAULT_AGENT_PERSONA.name;
      const avatar = typeof parsed.avatar === 'string' && parsed.avatar.trim() ? parsed.avatar.trim() : DEFAULT_AGENT_PERSONA.avatar;
      return { name, avatar };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_AGENT_PERSONA;
}

export function setAgentPersona(persona: AgentPersona): void {
  try {
    const name = persona.name.trim().slice(0, 12) || DEFAULT_AGENT_PERSONA.name;
    const avatar = persona.avatar.trim() || DEFAULT_AGENT_PERSONA.avatar;
    localStorage.setItem(AGENT_KEY, JSON.stringify({ name, avatar }));
  } catch {
    /* ignore */
  }
}

export { FINANCE_CATEGORIES };
