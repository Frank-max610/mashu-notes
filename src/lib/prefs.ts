import type { AgentPersona, Note, NoteInput, NoteMeta, NotePosition } from './types';
import { isNoteKind, HEALTH_METRICS, MEAL_SLOTS, FINANCE_CATEGORIES } from './kinds';
import { extractTags } from './links';

/** Simple client-side preference storage (theme, onboarding flag). */

const THEME_KEY = 'mashu.theme.v1';
const ONBOARDED_KEY = 'mashu.onboarded.v1';

/** Previous brands' keys, adopted once so upgrades keep their preferences. */
const LEGACY_THEME_KEYS = ['rixin.theme.v1', 'mochi.theme.v1', 'inkstone.theme.v1'] as const;
const LEGACY_ONBOARDED_KEYS = ['rixin.onboarded.v1', 'mochi.onboarded.v1', 'inkstone.onboarded.v1'] as const;

export function getStoredTheme(): 'dark' | 'light' | 'system' {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
    // Older brands: adopt the preference synchronously, before first paint.
    for (const key of LEGACY_THEME_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy === 'dark' || legacy === 'light' || legacy === 'system') {
        localStorage.setItem(THEME_KEY, legacy);
        localStorage.removeItem(key);
        return legacy;
      }
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
    for (const key of LEGACY_ONBOARDED_KEYS) {
      if (localStorage.getItem(key) === '1') {
        localStorage.setItem(ONBOARDED_KEY, '1');
        localStorage.removeItem(key);
        return true;
      }
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
  if (value.directory && typeof value.directory === 'object') {
    const directory = value.directory as Record<string, unknown>;
    const color = typeof directory.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(directory.color) ? directory.color : undefined;
    meta.directory = color ? { color } : {};
  }
  if (value.plan && typeof value.plan === 'object') {
    const plan = value.plan as Record<string, unknown>;
    const status = plan.status;
    if (status === 'todo' || status === 'doing' || status === 'done') {
      meta.plan = {
        status,
        dueAt: finiteNumber(plan.dueAt),
      };
      if (meta.plan.dueAt === undefined) delete meta.plan.dueAt;
    }
  }
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
    archivedAt: finiteNumber(value.archivedAt),
    dirId: typeof value.dirId === 'string' && value.dirId ? value.dirId : undefined,
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

const AGENT_KEY = 'mashu.agent.v1';
const LEGACY_AGENT_KEYS = ['rixin.agent.v1', 'mochi.agent.v1'] as const;

export interface AgentAvatarOption {
  id: string;
  label: string;
}

/** Abstract node marks for the local helper (design doc §09: no cartoon avatar). */
export const AGENT_AVATARS: readonly AgentAvatarOption[] = [
  { id: 'node', label: '节点' },
  { id: 'orbit', label: '轨道' },
  { id: 'ring', label: '圆环' },
  { id: 'square', label: '方点' },
  { id: 'triad', label: '三点' },
  { id: 'spark', label: '星点' },
  { id: 'wave', label: '波纹' },
  { id: 'grid', label: '网格' },
];

/** Any earlier avatar (emoji mascot or gradient sigil) maps to the Mochi Node. */
const LEGACY_AVATAR_IDS = new Set([
  'mochi', 'cat', 'leaf', 'sun', 'star', 'book', 'tea', 'bowl',
  'orb', 'initial', 'seal',
]);
const LEGACY_AGENT_NAMES = new Set(['小助手', '知几']);

export const DEFAULT_AGENT_PERSONA: AgentPersona = { name: '小麻薯', avatar: 'node' };

function personaFromRaw(raw: string | null): AgentPersona | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentPersona>;
    let name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : DEFAULT_AGENT_PERSONA.name;
    if (LEGACY_AGENT_NAMES.has(name)) name = DEFAULT_AGENT_PERSONA.name;
    let avatar = typeof parsed.avatar === 'string' && parsed.avatar.trim() ? parsed.avatar.trim() : DEFAULT_AGENT_PERSONA.avatar;
    if (LEGACY_AVATAR_IDS.has(avatar)) avatar = DEFAULT_AGENT_PERSONA.avatar;
    return { name, avatar };
  } catch {
    return null;
  }
}

export function getAgentPersona(): AgentPersona {
  try {
    const stored = personaFromRaw(localStorage.getItem(AGENT_KEY));
    if (stored) return stored;
    for (const key of LEGACY_AGENT_KEYS) {
      const legacy = personaFromRaw(localStorage.getItem(key));
      if (legacy) {
        localStorage.setItem(AGENT_KEY, JSON.stringify(legacy));
        localStorage.removeItem(key);
        return legacy;
      }
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

/**
 * Adopt every legacy preference key in one go and remove the old copies.
 * Called once when the vault boots, so nothing from the 麻薯/砚 era lingers in
 * localStorage even if that particular preference is never read by the UI.
 */
export function migrateLegacyPreferences(): void {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme !== 'dark' && theme !== 'light' && theme !== 'system') {
      for (const key of LEGACY_THEME_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy === 'dark' || legacy === 'light' || legacy === 'system') {
          localStorage.setItem(THEME_KEY, legacy);
          break;
        }
      }
    }
    if (localStorage.getItem(ONBOARDED_KEY) !== '1') {
      for (const key of LEGACY_ONBOARDED_KEYS) {
        if (localStorage.getItem(key) === '1') {
          localStorage.setItem(ONBOARDED_KEY, '1');
          break;
        }
      }
    }
    if (!localStorage.getItem(AGENT_KEY)) {
      for (const key of LEGACY_AGENT_KEYS) {
        const persona = personaFromRaw(localStorage.getItem(key));
        if (persona) {
          localStorage.setItem(AGENT_KEY, JSON.stringify(persona));
          break;
        }
      }
    }
    if (localStorage.getItem(INSTALL_HINT_KEY) !== '1') {
      for (const key of LEGACY_INSTALL_HINT_KEYS) {
        if (localStorage.getItem(key) === '1') {
          localStorage.setItem(INSTALL_HINT_KEY, '1');
          break;
        }
      }
    }
    for (const key of [
      ...LEGACY_THEME_KEYS,
      ...LEGACY_ONBOARDED_KEYS,
      ...LEGACY_AGENT_KEYS,
      ...LEGACY_INSTALL_HINT_KEYS,
    ]) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore private-mode / quota errors */
  }
}

const INSTALL_HINT_KEY = 'mashu.installHint.v1';
const LEGACY_INSTALL_HINT_KEYS = ['rixin.installHint.v1', 'mochi.installHint.v1'] as const;

export function isInstallHintDismissed(): boolean {
  try {
    if (localStorage.getItem(INSTALL_HINT_KEY) === '1') return true;
    for (const key of LEGACY_INSTALL_HINT_KEYS) {
      if (localStorage.getItem(key) === '1') {
        localStorage.setItem(INSTALL_HINT_KEY, '1');
        localStorage.removeItem(key);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1');
  } catch {
    /* ignore */
  }
}

export { FINANCE_CATEGORIES };
