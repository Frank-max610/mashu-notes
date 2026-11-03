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
