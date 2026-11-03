import type { Note } from './types';
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

/** Create a brand-new note object. */
export function makeNote(input: { title?: string; content?: string } = {}): Note {
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
  };
}
