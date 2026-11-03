import { useMemo } from 'react';
import type { Note, NoteKind } from '../lib/types';
import { KIND_INFO, NOTE_KINDS } from '../lib/kinds';
import { dayKeyOf, noteDayKey } from '../lib/insights';
import { RecordRow } from '../components/RecordRow';
import { Icon } from '../components/Icon';

export type KindFilter = NoteKind | 'all';

export interface RecordsScreenProps {
  notes: Note[];
  loading: boolean;
  kindFilter: KindFilter;
  onKindFilter: (kind: KindFilter) => void;
  onOpenNote: (id: string) => void;
  onNoteMenu: (note: Note) => void;
  onOpenSearch: () => void;
  onQuickCapture: (kind?: NoteKind) => void;
  storageWarning: string | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function dayLabel(dayKey: string, now = new Date()): string {
  const todayKey = dayKeyOf(now);
  if (dayKey === todayKey) return '今天';
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey === dayKeyOf(yesterday)) return '昨天';
  const [, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Number(dayKey.slice(0, 4)), month - 1, day);
  return `${month}月${day}日 · 周${WEEKDAYS[date.getDay()]}`;
}

/** 记录 — a scannable timeline of life records (design doc §07). */
export function RecordsScreen({
  notes,
  loading,
  kindFilter,
  onKindFilter,
  onOpenNote,
  onNoteMenu,
  onOpenSearch,
  onQuickCapture,
  storageWarning,
}: RecordsScreenProps) {
  const filtered = useMemo(() => {
    if (kindFilter === 'all') return notes;
    return notes.filter((note) => note.kind === kindFilter);
  }, [notes, kindFilter]);

  const pinned = filtered.filter((note) => note.pinned);
  const rest = filtered.filter((note) => !note.pinned);

  const groups = useMemo(() => {
    const buckets = new Map<string, Note[]>();
    for (const note of rest) {
      const key = noteDayKey(note);
      const list = buckets.get(key);
      if (list) list.push(note);
      else buckets.set(key, [note]);
    }
    return [...buckets.entries()];
  }, [rest]);

  return (
    <div className="screen records-screen">
      <header className="screen-header records-header">
        <div className="records-title-block">
          <h1 className="page-title">记录</h1>
          <p className="records-count">{notes.length} 条</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="搜索" onClick={onOpenSearch}>
            <Icon name="search" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="记一笔" onClick={() => onQuickCapture()}>
            <Icon name="plus" size={20} />
          </button>
        </div>
      </header>

      {storageWarning ? (
        <div className="banner banner-warn" role="status">
          <Icon name="warn" size={15} />
          <span>{storageWarning}</span>
        </div>
      ) : null}

      <div className="filter-bar" role="tablist" aria-label="按类型筛选">
        <button
          type="button"
          role="tab"
          aria-selected={kindFilter === 'all'}
          className={`chip${kindFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => onKindFilter('all')}
        >
          全部
        </button>
        {NOTE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kindFilter === kind}
            className={`chip${kindFilter === kind ? ' is-active' : ''}`}
            onClick={() => onKindFilter(kind)}
          >
            {KIND_INFO[kind].label}
          </button>
        ))}
      </div>

      <div className="screen-body records-body">
        {loading && notes.length === 0 ? (
          <div className="empty">
            <div className="spinner" />
            <p className="empty-text">正在读取本地记录…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Icon name={kindFilter === 'all' ? 'notes' : 'search'} size={24} />
            <p className="empty-title">{kindFilter === 'all' ? '还没有记录' : '这个类型还没有内容'}</p>
            <p className="empty-text">用一句话记下今天，或者手动填写。</p>
            <button type="button" className="btn btn-primary" onClick={() => onQuickCapture()}>
              记一笔
            </button>
          </div>
        ) : (
          <>
            {pinned.length > 0 ? (
              <section aria-label="置顶">
                <h2 className="records-group-title">
                  <Icon name="pin" size={13} /> 置顶
                </h2>
                <div className="pinned-list">
                  {pinned.map((note) => (
                    <RecordRow key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} pinnedRow />
                  ))}
                </div>
              </section>
            ) : null}

            {groups.map(([dayKey, dayNotes]) => (
              <section key={dayKey} aria-label={dayLabel(dayKey)}>
                <h2 className="records-group-title">{dayLabel(dayKey)}</h2>
                <div className="record-list">
                  {dayNotes.map((note) => (
                    <RecordRow key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
