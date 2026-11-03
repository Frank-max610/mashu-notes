import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { buildTitleIndex, resolveLink } from '../lib/links';
import { renderMarkdown } from '../lib/markdown';

export interface MarkdownPreviewProps {
  note: Note;
  notes: Note[];
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}

/**
 * Rendered Markdown with clickable wiki links. Raw HTML is disabled in the
 * renderer, so injecting the result is safe; wiki links are handled here.
 */
export function MarkdownPreview({ note, notes, onOpenNote, onCreateNote }: MarkdownPreviewProps) {
  const titleIndex = useMemo(() => buildTitleIndex(notes), [notes]);

  const html = useMemo(
    () =>
      renderMarkdown(note.content, {
        resolveTitle: (target) => resolveLink(target, titleIndex)?.title ?? null,
      }),
    [note.content, titleIndex],
  );

  return (
    <div
      className="markdown-body"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest?.('a.wiki-link');
        if (!anchor) return;
        event.preventDefault();
        const target = anchor.getAttribute('data-wiki-target');
        if (!target) return;
        const resolved = resolveLink(target, titleIndex);
        if (resolved) onOpenNote(resolved.id);
        else onCreateNote(target);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
