import type { Note } from './types';
import { normalizeNote } from './prefs';

/**
 * Persistence layer for 日新: IndexedDB with a localStorage fallback.
 * Everything stays on the device. Data from previous brands (麻薯 / 砚) is
 * migrated into the new `rixin` database on first open.
 */

const DB_NAME = 'rixin';
const DB_VERSION = 2;
const STORE = 'notes';
const LS_KEY = 'rixin.notes.v1';

/** Storage from previous brands, adopted once. */
const LEGACY_DB_NAMES = ['mochi', 'inkstone'] as const;
const LEGACY_LS_NOTES = ['mochi.notes.v1', 'inkstone.notes.v1'] as const;

export type StorageMode = 'indexeddb' | 'localstorage';

let mode: StorageMode | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const store = request.transaction?.objectStore(STORE);
        if (store) {
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const normalized = normalizeNote(cursor.value);
            if (normalized) cursor.update(normalized);
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB blocked'));
    };
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function normalizeAll(values: unknown[]): Note[] {
  return values
    .map((value) => normalizeNote(value))
    .filter((note): note is Note => note !== null);
}

function readLocal(): Note[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeAll(parsed);
  } catch {
    return [];
  }
}

function writeLocal(notes: Note[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(notes));
}

/** Whether the vault is stored in IndexedDB or fell back to localStorage. */
export function getStorageMode(): StorageMode {
  return mode ?? (typeof indexedDB === 'undefined' ? 'localstorage' : 'indexeddb');
}

/* ---------------- migration from previous brands ---------------- */

let legacyMigration: Promise<Note[]> | null = null;

function readLegacyLocalNotes(): Note[] {
  const notes: Note[] = [];
  for (const key of LEGACY_LS_NOTES) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) notes.push(...normalizeAll(parsed));
    } catch {
      /* ignore a broken legacy entry */
    }
  }
  return notes;
}

function legacyDatabaseExists(): Promise<boolean> {
  return new Promise((resolve) => {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
    if (typeof factory.databases !== 'function') {
      resolve(true);
      return;
    }
    factory
      .databases()
      .then((list) => {
        const names = new Set(list.map((database) => database.name));
        resolve(LEGACY_DB_NAMES.some((name) => names.has(name)));
      })
      .catch(() => resolve(true));
  });
}

function readOneLegacyDatabase(name: string): Promise<Note[]> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (notes: Note[]) => {
      if (settled) return;
      settled = true;
      resolve(notes);
    };
    try {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.close();
          done([]);
          return;
        }
        try {
          const transaction = database.transaction(STORE, 'readonly');
          const getAll = transaction.objectStore(STORE).getAll();
          getAll.onsuccess = () => {
            done(normalizeAll((getAll.result as unknown[]) ?? []));
            database.close();
          };
          getAll.onerror = () => {
            done([]);
            database.close();
          };
        } catch {
          done([]);
          database.close();
        }
      };
      request.onerror = () => done([]);
      request.onblocked = () => done([]);
      setTimeout(() => done([]), 1500);
    } catch {
      done([]);
    }
  });
}

/** Remove every previous-brand database and fallback notes key. */
function cleanupLegacyStorage(): void {
  for (const name of LEGACY_DB_NAMES) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      /* ignore */
    }
  }
  for (const key of LEGACY_LS_NOTES) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Move notes from 麻薯 (mochi) / 砚 (inkstone) into the rixin database.
 * The old copies are only deleted after the merged vault has been written.
 */
async function migrateLegacyVault(): Promise<Note[]> {
  if (!legacyMigration) {
    legacyMigration = (async () => {
      const byId = new Map<string, Note>();
      for (const note of readLegacyLocalNotes()) byId.set(note.id, note);

      const hasLegacyDatabase = await legacyDatabaseExists();
      if (hasLegacyDatabase) {
        for (const name of LEGACY_DB_NAMES) {
          for (const note of await readOneLegacyDatabase(name)) byId.set(note.id, note);
        }
      }

      const notes = [...byId.values()];
      let written = false;
      if (notes.length > 0) {
        await saveNotes(notes);
        written = getStorageMode() === 'indexeddb';
      }
      if (notes.length === 0 || written) cleanupLegacyStorage();
      return notes;
    })();
  }
  return legacyMigration;
}

/**
 * If a previous session fell back to localStorage, fold those notes into
 * IndexedDB so a later successful open does not hide them.
 */
async function recoverLocalFallback(notes: Note[]): Promise<Note[]> {
  const legacy = readLocal();
  if (legacy.length === 0) return notes;
  const byId = new Map(notes.map((note) => [note.id, note]));
  let changed = false;
  for (const note of legacy) {
    const current = byId.get(note.id);
    if (!current || note.updatedAt > current.updatedAt) {
      byId.set(note.id, note);
      changed = true;
    }
  }
  const merged = changed ? [...byId.values()] : notes;
  if (changed) await saveNotes(merged);
  if (getStorageMode() === 'indexeddb') {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore quota/security errors */
    }
  }
  return merged;
}

/* ---------------- public API ---------------- */

/** Load every note in the vault. */
export async function loadNotes(): Promise<Note[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    const notes = await new Promise<Note[]>((resolve, reject) => {
      request.onsuccess = () => resolve(normalizeAll(request.result as unknown[]));
      request.onerror = () => reject(request.error);
    });
    await txDone(tx);
    mode = 'indexeddb';
    if (notes.length === 0) {
      const migrated = await migrateLegacyVault();
      if (migrated.length > 0) return recoverLocalFallback(migrated);
    }
    return recoverLocalFallback(notes);
  } catch {
    mode = 'localstorage';
    return readLocal();
  }
}

/** Insert or update notes in one transaction. */
export async function saveNotes(notes: Note[]): Promise<void> {
  if (notes.length === 0) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const note of notes) store.put(note);
    await txDone(tx);
    mode = 'indexeddb';
  } catch {
    mode = 'localstorage';
    const byId = new Map(readLocal().map((note) => [note.id, note]));
    for (const note of notes) byId.set(note.id, note);
    writeLocal([...byId.values()]);
  }
}

/** Delete a single note. */
export async function deleteNoteFromDb(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
    mode = 'indexeddb';
  } catch {
    mode = 'localstorage';
    writeLocal(readLocal().filter((note) => note.id !== id));
  }
}

/** Replace the whole vault (used by import). */
export async function replaceAllNotes(notes: Note[]): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const note of notes) store.put(note);
    await txDone(tx);
    mode = 'indexeddb';
  } catch {
    mode = 'localstorage';
    writeLocal(notes);
  }
}

/** Wipe the vault. */
export async function clearAllNotes(): Promise<void> {
  await replaceAllNotes([]);
}

/** Approximate quota usage, when the browser reports it. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Ask the browser to keep this origin's data out of automatic eviction. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
