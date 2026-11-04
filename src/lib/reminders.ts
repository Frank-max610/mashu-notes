import type { Note } from './types';
import { dayKeyOf, noteDayKey } from './insights';

const KEY = 'mashu.reminders.v1';
const LAST_NOTIFIED_KEY = 'mashu.reminders.lastNotified.v1';

export interface ReminderSettings {
  enabled: boolean;
  /** Local HH:mm — when the daily nudge should appear. */
  time: string;
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, time: '21:00' };

export function getReminderSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_REMINDERS };
    const value = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled: value.enabled !== false,
      time: typeof value.time === 'string' && /^\d{2}:\d{2}$/.test(value.time) ? value.time : DEFAULT_REMINDERS.time,
    };
  } catch {
    return { ...DEFAULT_REMINDERS };
  }
}

export function setReminderSettings(patch: Partial<ReminderSettings>): ReminderSettings {
  const next = { ...getReminderSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function plansDueToday(notes: Note[], now = new Date()): Note[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  return notes.filter(
    (note) =>
      note.meta.plan &&
      note.meta.plan.status !== 'done' &&
      !note.archivedAt &&
      (note.meta.plan.dueAt === undefined || note.meta.plan.dueAt <= end),
  );
}

/** Which daily areas have not been written yet today. */
export function missingToday(notes: Note[], now = new Date()): { diary: boolean; finance: boolean; any: boolean } {
  const key = dayKeyOf(now);
  const today = notes.filter((note) => noteDayKey(note) === key && !note.archivedAt && !note.meta.directory);
  const diary = !today.some((note) => note.kind === 'diary');
  const finance = !today.some((note) => note.kind === 'finance');
  return { diary, finance, any: diary || finance };
}

export function shouldShowReminder(now = new Date()): boolean {
  const settings = getReminderSettings();
  if (!settings.enabled) return false;
  const [hour, minute] = settings.time.split(':').map(Number);
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
  if (now.getTime() < due) return false;
  try {
    return localStorage.getItem(LAST_NOTIFIED_KEY) !== dayKeyOf(now);
  } catch {
    return true;
  }
}

export function markReminderShown(now = new Date()): void {
  try {
    localStorage.setItem(LAST_NOTIFIED_KEY, dayKeyOf(now));
  } catch {
    /* ignore */
  }
}

export function reminderText(notes: Note[], now = new Date()): string | null {
  const due = plansDueToday(notes, now);
  const missing = missingToday(notes, now);
  const parts: string[] = [];
  if (due.length > 0) parts.push(`${due.length} 个计划今天到点`);
  if (missing.diary) parts.push('还没写日记');
  if (missing.finance) parts.push('还没记今天的支出');
  return parts.length > 0 ? parts.join('；') : null;
}
