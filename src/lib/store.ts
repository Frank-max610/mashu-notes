import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NotePatch } from './types';
import { extractTags, noteSummary, normalizeTitle } from './links';
import {
  clearAllNotes,
  deleteNoteFromDb,
  getStorageMode,
  loadNotes,
  replaceAllNotes,
  requestPersistentStorage,
  saveNotes,
  storageEstimate,
  type StorageMode,
} from './db';
import { hasOnboarded, makeNote, markOnboarded } from './prefs';
import { createSeedNotes } from './seed';

/** Pin first, then most recently updated. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export interface NotesApi {
  notes: Note[];
  sortedNotes: Note[];
  ready: boolean;
  storageMode: StorageMode;
  storageWarning: string | null;
  createNote(input?: { title?: string; content?: string }): Promise<Note>;
  updateNote(id: string, patch: NotePatch): void;
  deleteNote(id: string): Promise<void>;
  togglePin(id: string): void;
  replaceAll(notes: Note[]): Promise<void>;
  clearAll(): Promise<void>;
  findByTitle(title: string): Note | undefined;
  ensureNote(title: string): Promise<Note>;
  flush(): Promise<void>;
  usage(): Promise<{ usage: number; quota: number } | null>;
}

const FLUSH_DELAY_MS = 350;

/**
 * The single source of truth for the vault. Edits are applied optimistically in
 * memory and persisted in debounced batches, so typing never waits on I/O.
 */
export function useNotes(): NotesApi {
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>('indexeddb');
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const notesRef = useRef<Note[]>([]);
  const dirtyRef = useRef(new Map<string, Note>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef = useRef(false);

  const commit = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current.size === 0) return;
    const pending = [...dirtyRef.current.values()];
    dirtyRef.current.clear();
    try {
      await saveNotes(pending);
    } catch {
      setStorageWarning('保存失败，请检查浏览器存储空间，并立即导出备份。');
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, FLUSH_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        let stored = await loadNotes();
        if (stored.length === 0 && !hasOnboarded()) {
          stored = createSeedNotes();
          await saveNotes(stored);
          markOnboarded();
        }
        if (cancelled) return;
        commit(sortNotes(stored));
        setStorageMode(getStorageMode());
        void requestPersistentStorage();
      } catch {
        setStorageWarning('读取本地数据失败，当前改动可能不会被保存。');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);

  // Persist whatever is pending when the app goes to the background.
  useEffect(() => {
    const onHide = () => {
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  const createNote = useCallback(
    async (input: { title?: string; content?: string } = {}) => {
      const note = makeNote(input);
      commit(sortNotes([note, ...notesRef.current]));
      try {
        await saveNotes([note]);
      } catch {
        setStorageWarning('保存失败，请检查浏览器存储空间。');
      }
      return note;
    },
    [commit],
  );

  const updateNote = useCallback(
    (id: string, patch: NotePatch) => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) return;
      const content = patch.content ?? current.content;
      const next: Note = {
        ...current,
        title: patch.title !== undefined ? patch.title : current.title,
        content,
        pinned: patch.pinned !== undefined ? patch.pinned : current.pinned,
        tags: extractTags(content),
        updatedAt:
          patch.content !== undefined || patch.title !== undefined
            ? Date.now()
            : current.updatedAt,
      };
      dirtyRef.current.set(id, next);
      commit(
        alreadySorted(notesRef.current, next)
          ? notesRef.current.map((note) => (note.id === id ? next : note))
          : sortNotes(notesRef.current.map((note) => (note.id === id ? next : note))),
      );
      scheduleFlush();
    },
    [commit, scheduleFlush],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      dirtyRef.current.delete(id);
      commit(notesRef.current.filter((note) => note.id !== id));
      try {
        await deleteNoteFromDb(id);
      } catch {
        setStorageWarning('删除失败，请稍后重试。');
      }
    },
    [commit],
  );

  const togglePin = useCallback(
    (id: string) => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) return;
      const next: Note = { ...current, pinned: !current.pinned };
      dirtyRef.current.set(id, next);
      commit(sortNotes(notesRef.current.map((note) => (note.id === id ? next : note))));
      scheduleFlush();
    },
    [commit, scheduleFlush],
  );

  const replaceAll = useCallback(
    async (incoming: Note[]) => {
      dirtyRef.current.clear();
      await replaceAllNotes(incoming);
      markOnboarded();
      commit(sortNotes(incoming));
    },
    [commit],
  );

  const clearAll = useCallback(async () => {
    dirtyRef.current.clear();
    await clearAllNotes();
    markOnboarded();
    commit([]);
  }, [commit]);

  const findByTitle = useCallback((title: string) => {
    const key = normalizeTitle(title);
    if (!key) return undefined;
    return notesRef.current.find((note) => normalizeTitle(note.title) === key);
  }, []);

  const ensureNote = useCallback(
    async (title: string) => {
      const existing = findByTitle(title);
      if (existing) return existing;
      return createNote({ title: title.trim() || '未命名笔记', content: '' });
    },
    [createNote, findByTitle],
  );

  const usage = useCallback(() => storageEstimate(), []);

  const sortedNotes = useMemo(() => sortNotes(notes), [notes]);

  return {
    notes,
    sortedNotes,
    ready,
    storageMode,
    storageWarning,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
    replaceAll,
    clearAll,
    findByTitle,
    ensureNote,
    flush,
    usage,
  };
}

/**
 * Cheap check: was the updated note already in the right place? Avoids
 * re-sorting the whole list on every keystroke (which would reorder the vault
 * while editing).
 */
function alreadySorted(notes: Note[], updated: Note): boolean {
  const sorted = sortNotes(notes);
  const indexBefore = notes.findIndex((note) => note.id === updated.id);
  const indexAfter = sorted.findIndex((note) => note.id === updated.id);
  return indexBefore === indexAfter;
}

/** Convenience projection used all over the UI. */
export function summaries(notes: Note[]) {
  return notes.map(noteSummary);
}
