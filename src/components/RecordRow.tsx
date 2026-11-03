import type { ReactNode } from 'react';
import type { Note } from '../lib/types';
import { KIND_INFO, describeMeta } from '../lib/kinds';
import { Icon } from './Icon';

export interface RecordRowProps {
  note: Note;
  onOpen: (id: string) => void;
  onMenu: (note: Note) => void;
  /** Search snippet with highlighted matches. */
  snippet?: ReactNode;
  showDate?: boolean;
  pinnedRow?: boolean;
  hideMenu?: boolean;
}

function timeText(note: Note, showDate: boolean): string {
  const date = new Date(note.meta.occurredAt ?? note.createdAt);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!showDate) return `${hh}:${mm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

/**
 * One scannable life-record row: category dot + title + one line of structured
 * data + time, with a discreet More button. Used by 记录 and 搜索 (design doc §07).
 */
export function RecordRow({ note, onOpen, onMenu, snippet, showDate = false, pinnedRow = false, hideMenu = false }: RecordRowProps) {
  const info = KIND_INFO[note.kind];
  const meta = describeMeta(note);
  return (
    <div
      className={`record-row${note.pinned ? ' is-pinned' : ''}${pinnedRow ? ' is-pinned-row' : ''}`}
      style={{
        ['--kind-accent' as string]: `var(${info.accentVar})`,
        ['--kind-soft' as string]: `var(${info.accentSoftVar})`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`打开${info.label}：${note.title}`}
      onClick={() => onOpen(note.id)}
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
      <span className="record-dot" aria-hidden="true" />
      <span className="record-main">
        <span className="record-title">{note.title || '未命名记录'}</span>
        {snippet ? (
          <span className="record-snippet">{snippet}</span>
        ) : meta ? (
          <span className="record-meta">
            {info.label} · {meta}
          </span>
        ) : (
          <span className="record-meta">{info.label}</span>
        )}
      </span>
      <span className="record-side">
        <span className="record-time">{timeText(note, showDate)}</span>
        {hideMenu ? null : (
          <button
            type="button"
            className="record-more"
            aria-label={`更多操作：${note.title || '未命名记录'}`}
            onClick={(event) => {
              event.stopPropagation();
              onMenu(note);
            }}
          >
            <Icon name="more" size={17} />
          </button>
        )}
      </span>
      {note.pinned ? <span className="record-pin-dot" aria-label="已置顶" /> : null}
    </div>
  );
}
