import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { allTags } from '../lib/links';
import { NoteCard } from '../components/NoteCard';
import { Icon } from '../components/Icon';

export interface NotesScreenProps {
  notes: Note[];
  loading: boolean;
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  onOpenNote: (id: string) => void;
  onNoteMenu: (note: Note) => void;
  onOpenSearch: () => void;
  storageWarning: string | null;
}

/** Home screen: vault overview, tag filter and note cards. */
export function NotesScreen({
  notes,
  loading,
  tagFilter,
  onTagFilter,
  onOpenNote,
  onNoteMenu,
  onOpenSearch,
  storageWarning,
}: NotesScreenProps) {
  const tags = useMemo(() => allTags(notes).slice(0, 16), [notes]);

  const filtered = useMemo(() => {
    if (!tagFilter) return notes;
    const key = tagFilter.toLowerCase();
    return notes.filter((note) => note.tags.some((tag) => tag.toLowerCase() === key));
  }, [notes, tagFilter]);

  const pinned = filtered.filter((note) => note.pinned);
  const rest = filtered.filter((note) => !note.pinned);

  return (
    <div className="screen notes-screen">
      <header className="screen-header app-header">
        <div className="app-brand">
          <span className="app-logo" aria-hidden="true">
            砚
          </span>
          <div className="app-brand-text">
            <h1 className="app-title">Inkstone</h1>
            <p className="app-subtitle">
              {notes.length === 0 ? '本地优先的笔记库' : `${notes.length} 条笔记 · 本地优先`}
            </p>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="搜索笔记" onClick={onOpenSearch}>
          <Icon name="search" size={21} />
        </button>
      </header>

      {storageWarning ? (
        <div className="banner banner-warn" role="status">
          <Icon name="warn" size={16} />
          <span>{storageWarning}</span>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="chips-row" role="tablist" aria-label="按标签筛选">
          <button
            type="button"
            role="tab"
            aria-selected={tagFilter === null}
            className={`chip${tagFilter === null ? ' is-active' : ''}`}
            onClick={() => onTagFilter(null)}
          >
            全部
          </button>
          {tags.map((tag) => (
            <button
              key={tag.tag}
              type="button"
              role="tab"
              aria-selected={tagFilter === tag.label}
              className={`chip${tagFilter?.toLowerCase() === tag.tag ? ' is-active' : ''}`}
              onClick={() => onTagFilter(tag.label)}
            >
              #{tag.label}
              <span className="chip-count">{tag.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="screen-body">
        {loading && notes.length === 0 ? (
          <div className="empty">
            <div className="spinner" />
            <p className="empty-text">正在打开笔记库…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Icon name="book" size={34} />
            <p className="empty-title">{tagFilter ? '这个标签下还没有笔记' : '还没有笔记'}</p>
            <p className="empty-text">
              {tagFilter ? '换一个标签看看，或点右下角新建一条。' : '点右下角的 + 开始第一条笔记，或从设置里导入备份。'}
            </p>
            {tagFilter ? (
              <button type="button" className="btn btn-ghost" onClick={() => onTagFilter(null)}>
                清除筛选
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {pinned.length > 0 ? (
              <section aria-label="置顶笔记">
                <div className="section-label">
                  <Icon name="pin" size={13} />
                  <span>置顶</span>
                </div>
                <div className="notes-list">
                  {pinned.map((note) => (
                    <NoteCard key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} />
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-label="全部笔记">
              {pinned.length > 0 && rest.length > 0 ? (
                <div className="section-label">
                  <span>全部</span>
                </div>
              ) : null}
              <div className="notes-list">
                {rest.map((note) => (
                  <NoteCard key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
