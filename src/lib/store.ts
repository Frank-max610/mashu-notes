import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteInput, NotePatch, NotePosition } from './types';
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
import { hasOnboarded, makeNote, markOnboarded, migrateLegacyPreferences } from './prefs';
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
  createNote(input?: NoteInput): Promise<Note>;
  updateNote(id: string, patch: NotePatch): void;
  /** Save a manual graph position (null clears it and lets the layout decide). */
  setNodePosition(id: string, position: NotePosition | null): void;
  /** Draw a hand-made link between two notes (undirected, de-duplicated). */
  addManualLink(sourceId: string, targetId: string): void;
  removeManualLink(sourceId: string, targetId: string): void;
  /** Clear every saved graph position so the auto layout takes over again. */
  resetNodePositions(): void;
  deleteNote(id: string): Promise<boolean>;
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
 * Load (and on first run seed) the vault exactly once per page load.
 *
 * React StrictMode mounts effects twice in development: the first run is
 * cancelled by its cleanup, so the work must live in a shared promise and the
 * commit/ready step must run for whichever effect is still alive. Caching the
 * promise also guarantees seeding can never happen twice.
 */
let vaultInitPromise: Promise<Note[]> | null = null;

function initializeVault(): Promise<Note[]> {
  if (!vaultInitPromise) {
    vaultInitPromise = (async () => {
      migrateLegacyPreferences();
      let stored = await loadNotes();
      if (stored.length === 0 && !hasOnboarded()) {
        stored = createSeedNotes();
        await saveNotes(stored);
        markOnboarded();
      }
      return stored;
    })();
    // Allow a retry after a failed boot instead of caching the rejection.
    vaultInitPromise.catch(() => {
      vaultInitPromise = null;
    });
  }
  return vaultInitPromise;
}

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

  const commit = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const inFlightRef = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current.size === 0) return;
    const pending = [...dirtyRef.current.values()];
    dirtyRef.current.clear();
    const task = (async () => {
      try {
        await saveNotes(pending);
      } catch {
        // Keep the batch: retry on the next edit/pagehide instead of dropping
        // the only copy of the text that was just typed.
        const live = new Set(notesRef.current.map((note) => note.id));
        for (const note of pending) {
          if (live.has(note.id) && !dirtyRef.current.has(note.id)) {
            dirtyRef.current.set(note.id, note);
          }
        }
        setStorageMode(getStorageMode());
        setStorageWarning('保存失败，请检查浏览器存储空间，并立即导出备份。');
      }
    })();
    inFlightRef.current = task;
    try {
      await task;
    } finally {
      if (inFlightRef.current === task) inFlightRef.current = null;
    }
  }, []);

  /**
   * Wait for any write that is already in progress. Destructive operations use
   * this so a late debounced save can never resurrect deleted or replaced notes.
   */
  const settleWrites = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Persist any unrelated pending edit first, otherwise clearing the timer
    // below would postpone it until the next edit or page hide.
    if (dirtyRef.current.size > 0) await flush();
    const pendingWrite = inFlightRef.current;
    if (pendingWrite) await pendingWrite;
  }, [flush]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, FLUSH_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    initializeVault()
      .then((stored) => {
        if (cancelled) return;
        commit(sortNotes(stored));
        setStorageMode(getStorageMode());
        void requestPersistentStorage();
      })
      .catch(() => {
        if (cancelled) return;
        setStorageWarning('读取本地数据失败，当前改动可能不会被保存。');
      })
      .finally(() => {
        if (cancelled) return;
        setReady(true);
      });
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
    async (input: NoteInput = {}) => {
      const note = makeNote(input);
      commit(sortNotes([note, ...notesRef.current]));
      try {
        await saveNotes([note]);
      } catch {
        setStorageMode(getStorageMode());
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
      const structural =
        patch.content !== undefined ||
        patch.title !== undefined ||
        patch.kind !== undefined ||
        patch.meta !== undefined;
      const next: Note = {
        ...current,
        title: patch.title !== undefined ? patch.title : current.title,
        content,
        pinned: patch.pinned !== undefined ? patch.pinned : current.pinned,
        kind: patch.kind !== undefined ? patch.kind : current.kind,
        meta: patch.meta !== undefined ? patch.meta : current.meta,
        tags: extractTags(content),
        updatedAt: structural ? Date.now() : current.updatedAt,
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
    async (id: string): Promise<boolean> => {
      dirtyRef.current.delete(id);
      const changed = notesRef.current
        .filter((note) => note.id !== id && note.manualLinks.includes(id))
        .map((note) => ({ ...note, manualLinks: note.manualLinks.filter((link) => link !== id) }));
      for (const note of changed) dirtyRef.current.set(note.id, note);
      commit(
        notesRef.current
          .filter((note) => note.id !== id)
          .map((note) => changed.find((item) => item.id === note.id) ?? note),
      );
      try {
        await settleWrites();
        await deleteNoteFromDb(id);
        setStorageMode(getStorageMode());
        return true;
      } catch {
        setStorageMode(getStorageMode());
        setStorageWarning('删除失败，请稍后重试。');
        return false;
      }
    },
    [commit, settleWrites],
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

  const setNodePosition = useCallback(
    (id: string, position: NotePosition | null) => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) return;
      const next: Note = {
        ...current,
        position: position
          ? { x: Math.min(1, Math.max(0, position.x)), y: Math.min(1, Math.max(0, position.y)) }
          : undefined,
      };
      dirtyRef.current.set(id, next);
      commit(notesRef.current.map((note) => (note.id === id ? next : note)));
      scheduleFlush();
    },
    [commit, scheduleFlush],
  );

  const addManualLink = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const source = notesRef.current.find((note) => note.id === sourceId);
      const target = notesRef.current.find((note) => note.id === targetId);
      if (!source || !target) return;
      // Manual links are undirected: store them on both ends so either node
      // shows the connection and can remove it.
      const link = (note: Note, other: string): Note =>
        note.manualLinks.includes(other)
          ? note
          : { ...note, manualLinks: [...note.manualLinks, other] };
      const nextSource = link(source, targetId);
      const nextTarget = link(target, sourceId);
      const nextNotes = notesRef.current.map((note) =>
        note.id === sourceId ? nextSource : note.id === targetId ? nextTarget : note,
      );
      if (nextSource !== source) dirtyRef.current.set(sourceId, nextSource);
      if (nextTarget !== target) dirtyRef.current.set(targetId, nextTarget);
      commit(nextNotes);
      scheduleFlush();
    },
    [commit, scheduleFlush],
  );

  const removeManualLink = useCallback(
    (sourceId: string, targetId: string) => {
      const source = notesRef.current.find((note) => note.id === sourceId);
      const target = notesRef.current.find((note) => note.id === targetId);
      if (!source || !target) return;
      if (!source.manualLinks.includes(targetId) && !target.manualLinks.includes(sourceId)) return;
      const strip = (note: Note, other: string): Note =>
        note.manualLinks.includes(other)
          ? { ...note, manualLinks: note.manualLinks.filter((link) => link !== other) }
          : note;
      const nextSource = strip(source, targetId);
      const nextTarget = strip(target, sourceId);
      if (nextSource !== source) dirtyRef.current.set(sourceId, nextSource);
      if (nextTarget !== target) dirtyRef.current.set(targetId, nextTarget);
      commit(
        notesRef.current.map((note) =>
          note.id === sourceId ? nextSource : note.id === targetId ? nextTarget : note,
        ),
      );
      scheduleFlush();
    },
    [commit, scheduleFlush],
  );

  const resetNodePositions = useCallback(() => {
    let changed = false;
    const next = notesRef.current.map((note) => {
      if (!note.position) return note;
      changed = true;
      const updated: Note = { ...note, position: undefined };
      dirtyRef.current.set(note.id, updated);
      return updated;
    });
    if (!changed) return;
    commit(next);
    scheduleFlush();
  }, [commit, scheduleFlush]);

  const replaceAll = useCallback(
    async (incoming: Note[]) => {
      dirtyRef.current.clear();
      await settleWrites();
      await replaceAllNotes(incoming);
      markOnboarded();
      commit(sortNotes(incoming));
    },
    [commit, settleWrites],
  );

  const clearAll = useCallback(async () => {
    dirtyRef.current.clear();
    await settleWrites();
    await clearAllNotes();
    markOnboarded();
    commit([]);
  }, [commit, settleWrites]);

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
    setNodePosition,
    addManualLink,
    removeManualLink,
    resetNodePositions,
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
