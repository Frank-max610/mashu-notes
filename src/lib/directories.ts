import type { Note } from './types';

export const DIRECTORY_COLORS = ['#65788a', '#b45d35', '#627a4e', '#9a7112', '#7d7164', '#8a5a7a', '#4f6f8a', '#8a6a3c'];

export function isDirectory(note: Note): boolean {
  return Boolean(note.meta.directory) && !note.archivedAt;
}

export function directoryList(notes: Note[]): Note[] {
  return notes.filter(isDirectory).sort((a, b) => a.createdAt - b.createdAt);
}

export function directoryNoteMap(notes: Note[]): Map<string, Note> {
  return new Map(directoryList(notes).map((note) => [note.id, note]));
}

export function directoryColor(directory: Note | undefined): string {
  return directory?.meta.directory?.color ?? '#7d7164';
}

export function countInDirectory(notes: Note[], dirId: string): number {
  return notes.filter((note) => note.dirId === dirId && !isDirectory(note) && !note.archivedAt).length;
}

export function notesInDirectory(notes: Note[], dirId: string): Note[] {
  return notes.filter((note) => note.dirId === dirId && !isDirectory(note) && !note.archivedAt);
}

export function unassignedNotes(notes: Note[]): Note[] {
  return notes.filter((note) => !note.dirId && !isDirectory(note) && !note.archivedAt && !note.meta.plan);
}

const AUTOFILE_KEY = 'mashu.autofile.v1';

/** Auto-organising records into the matching graph directory (default on). */
export function getAutoFileEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOFILE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoFileEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOFILE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const KIND_DIRECTORY_WORDS: Record<string, string[]> = {
  health: ['健康', '身体', '运动', '睡眠', '体重', '心率', '跑', '步', '锻炼', '健身'],
  finance: ['理财', '财务', '收支', '钱', '账', '花', '买', '工资'],
  diary: ['日记', '生活', '心情', '情绪'],
  food: ['饮食', '美食', '吃', '餐', '生活'],
  note: ['工作', '学习', '阅读', '读书', '灵感', '项目', '旅行', '会议', '课程'],
};

/** Semantic words used when a directory is named like a life area. */
const DIRECTORY_AREA_WORDS: ReadonlyArray<{ titleWords: string[]; contentWords: string[] }> = [
  { titleWords: ['健康', '身体', '运动'], contentWords: ['健康', '身体', '运动', '跑', '步', '睡', '体重', '心率', '锻炼', '健身'] },
  { titleWords: ['工作', '职业', '事业'], contentWords: ['工作', '会议', '项目', '同事', '上班', '客户', '加班'] },
  { titleWords: ['学习', '阅读', '读书', '成长'], contentWords: ['学习', '阅读', '读书', '书', '课程', '笔记', '考试'] },
  { titleWords: ['理财', '财务', '钱', '收支'], contentWords: ['理财', '财务', '收支', '钱', '花', '买', '工资', '账', '存'] },
  { titleWords: ['生活', '日记', '心情'], contentWords: ['生活', '日记', '心情', '情绪', '旅行', '朋友'] },
];

/**
 * Pick the directory a freshly captured record belongs to.
 * The graph is a directory network, so auto-organising is what makes a record
 * show up as part of the person's map.
 */
export function suggestDirectoryForNote(note: Note, notes: Note[]): Note | null {
  const directories = directoryList(notes);
  if (directories.length === 0) return null;
  if (note.meta.plan || note.meta.directory) return null;
  const haystack = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase();
  const kindWords = KIND_DIRECTORY_WORDS[note.kind] ?? [];
  let best: Note | null = null;
  let bestScore = 0;
  for (const directory of directories) {
    const title = directory.title.trim().toLowerCase();
    if (!title) continue;
    let score = 0;
    if (haystack.includes(title)) score += 6;
    for (const tag of note.tags) {
      if (directory.title.includes(tag) || tag.includes(directory.title)) score += 4;
    }
    for (const word of kindWords) {
      if (directory.title.includes(word)) score += 2;
    }
    for (const area of DIRECTORY_AREA_WORDS) {
      if (area.titleWords.some((word) => directory.title.includes(word))
        && area.contentWords.some((word) => haystack.includes(word))) {
        score += 4;
      }
    }
    if (score > bestScore) {
      best = directory;
      bestScore = score;
    }
  }
  return best;
}
