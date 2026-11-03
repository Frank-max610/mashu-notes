import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Note } from '../lib/types';
import { excerpt } from '../lib/markdown';
import { describeMeta, kindInfo } from '../lib/kinds';
import { formatRelativeTime } from '../lib/format';
import { Icon } from './Icon';

export interface NoteCardProps {
  note: Note;
  onOpen: (id: string) => void;
  onMenu: (note: Note) => void;
}

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE_PX = 10;

/** Calm list card: kind badge, structured summary, short excerpt. */
export function NoteCard({ note, onOpen, onMenu }: NoteCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);

  const info = kindInfo(note.kind);
  const metaLine = useMemo(() => describeMeta(note), [note]);
  const preview = useMemo(() => excerpt(note.content, 80), [note.content]);
  const updated = formatRelativeTime(note.updatedAt);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClickRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    clearTimer();
    timerRef.current = setTimeout(() => {
      suppressClickRef.current = true;
      onMenu(note);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) clearTimer();
  };

  return (
    <article
      className={`note-card kind-${note.kind}${note.pinned ? ' is-pinned' : ''}`}
      style={{
        ['--kind-accent' as string]: `var(${info.accentVar})`,
        ['--kind-soft' as string]: `var(${info.accentSoftVar})`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`打开${info.label}：${note.title}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onOpen(note.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(note);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(note.id);
        }
      }}
    >
      <div className="note-card-head">
        <span className="note-kind-badge">{info.label}</span>
        {note.pinned ? (
          <span className="note-card-pin" aria-label="已置顶">
            <Icon name="pin" size={14} />
          </span>
        ) : null}
      </div>
      <h3 className="note-card-title">{note.title || '未命名记录'}</h3>
      {metaLine ? <p className="note-card-meta-line">{metaLine}</p> : null}
      {preview ? <p className="note-card-excerpt">{preview}</p> : null}
      <div className="note-card-meta">
        <span className="note-card-time">{updated}</span>
        {note.tags.length > 0 ? (
          <span className="note-card-tags">
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="note-card-tag">
                #{tag}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </article>
  );
}
