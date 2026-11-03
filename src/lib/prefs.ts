import type { Note } from './types';
import { extractTags } from './links';

/** Simple client-side preference storage (theme, onboarding flag). */

const THEME_KEY = 'inkstone.theme.v1';
const ONBOARDED_KEY = 'inkstone.onboarded.v1';

export function getStoredTheme(): 'dark' | 'light' | 'system' {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    /* ignore */
  }
  return 'system';
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
    return localStorage.getItem(ONBOARDED_KEY) === '1';
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
