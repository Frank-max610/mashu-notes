import type { Note } from './types';

/**
 * Persistence layer: IndexedDB with a localStorage fallback (private mode,
 * blocked storage). Everything stays on the device — there is no server.
 */

const DB_NAME = 'mochi';
const DB_VERSION = 1;
const STORE = 'notes';
const LS_KEY = 'mochi.notes.v1';

/** Pre-rebrand (0.1.x) storage, migrated once on first open. */
const LEGACY_DB_NAME = 'inkstone';
const LEGACY_LS = {
  notes: 'inkstone.notes.v1',
  theme: 'inkstone.theme.v1',
  onboarded: 'inkstone.onboarded.v1',
} as const;
const THEME_KEY = 'mochi.theme.v1';
const ONBOARDED_KEY = 'mochi.onboarded.v1';

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
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Do not cache a failed open: a transient error (blocked upgrade, another
    // tab holding a transaction) must not degrade the whole session.
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

function readLocal(): Note[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(notes: Note[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(notes));
}

let legacyMigration: Promise<Note[]> | null = null;

function readLegacyLocalNotes(): Note[] {
  try {
    const raw = localStorage.getItem(LEGACY_LS.notes);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

/** Whether the pre-rebrand database still exists on this origin. */
function legacyDatabaseExists(): Promise<boolean> {
  return new Promise((resolve) => {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
    if (typeof factory.databases !== 'function') {
      resolve(true);
      return;
    }
    factory
      .databases()
      .then((list) => resolve(list.some((database) => database.name === LEGACY_DB_NAME)))
      .catch(() => resolve(true));
  });
}

function readLegacyIndexedDbNotes(): Promise<Note[]> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (notes: Note[]) => {
      if (settled) return;
      settled = true;
      resolve(notes);
    };
    try {
      const request = indexedDB.open(LEGACY_DB_NAME);
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
            done((getAll.result as Note[]) ?? []);
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

/**
 * Move a 0.1.x (Inkstone) vault into the Mochi database instead of throwing it
 * away. Notes from both old storage layers are merged by id, the old theme and
 * onboarding flags are carried over, and the legacy database is only deleted
 * after the copy has been written successfully.
 */
async function migrateLegacyVault(): Promise<Note[]> {
  if (!legacyMigration) {
    legacyMigration = (async () => {
      const byId = new Map<string, Note>();
      for (const note of readLegacyLocalNotes()) byId.set(note.id, note);

      if (await legacyDatabaseExists()) {
        for (const note of await readLegacyIndexedDbNotes()) byId.set(note.id, note);
      }

      // Adopt the old preferences (idempotent; the legacy keys are only
      // removed below, after the notes themselves have been persisted).
      try {
        if (!localStorage.getItem(THEME_KEY)) {
          const theme = localStorage.getItem(LEGACY_LS.theme);
          if (theme) localStorage.setItem(THEME_KEY, theme);
        }
        if (!localStorage.getItem(ONBOARDED_KEY)) {
          const onboarded = localStorage.getItem(LEGACY_LS.onboarded);
          if (onboarded) localStorage.setItem(ONBOARDED_KEY, onboarded);
        }
      } catch {
        /* ignore storage restrictions */
      }

      const notes = [...byId.values()];
      let written = false;
      if (notes.length > 0) {
        await saveNotes(notes);
        written = getStorageMode() === 'indexeddb';
      }
      // Clean up the old storage only once the copy really landed: deleting a
      // localStorage-only vault after a failed write would lose the last copy.
      if (notes.length === 0 || written) {
        if (written) {
          try {
            indexedDB.deleteDatabase(LEGACY_DB_NAME);
          } catch {
            /* ignore */
          }
        }
        try {
          localStorage.removeItem(LEGACY_LS.notes);
          localStorage.removeItem(LEGACY_LS.theme);
          localStorage.removeItem(LEGACY_LS.onboarded);
        } catch {
          /* ignore storage restrictions */
        }
      }
      return notes;
    })();
  }
  return legacyMigration;
}

/** Whether the vault is stored in IndexedDB or fell back to localStorage. */
export function getStorageMode(): StorageMode {
  return mode ?? (typeof indexedDB === 'undefined' ? 'localstorage' : 'indexeddb');
}

/** Load every note in the vault. */
export async function loadNotes(): Promise<Note[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    const notes = await new Promise<Note[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Note[]);
      request.onerror = () => reject(request.error);
    });
    await txDone(tx);
    mode = 'indexeddb';
    if (notes.length === 0) {
      // First run of 0.2.x on a device that may still hold 0.1.x notes.
      const migrated = await migrateLegacyVault();
      if (migrated.length > 0) return recoverLocalFallback(migrated);
    }
    return recoverLocalFallback(notes);
  } catch {
    mode = 'localstorage';
    return readLocal();
  }
}

/**
 * If a previous session fell back to localStorage (private mode, transient
 * IndexedDB failure), fold those notes into IndexedDB so they are not hidden by
 * a later successful open. The localStorage copy is only removed once the
 * merge has been written.
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
  // Only clear the fallback copy once the merge really landed in IndexedDB:
  // saveNotes falls back to localStorage when the write itself fails, and
  // deleting the only copy in that window would lose notes.
  if (getStorageMode() === 'indexeddb') {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore quota/security errors */
    }
  }
  return merged;
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
    const byId = new Map(readLocal().map((n) => [n.id, n]));
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
    writeLocal(readLocal().filter((n) => n.id !== id));
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
