import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { allTags, extractWikiLinks } from '../lib/links';
import { NoteCard } from '../components/NoteCard';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';

export interface NotesScreenProps {
  notes: Note[];
  loading: boolean;
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  onOpenNote: (id: string) => void;
  onNoteMenu: (note: Note) => void;
  onOpenSearch: () => void;
  onCreateNote: () => void;
  storageWarning: string | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function greetingFor(hour: number): string {
  if (hour < 5) return '夜深啦，早点睡呀';
  if (hour < 11) return '早上好呀 ☀️';
  if (hour < 14) return '中午好呀 🍚';
  if (hour < 18) return '下午好呀 🍵';
  if (hour < 23) return '晚上好呀 🌙';
  return '该睡啦，晚安 🌛';
}

function todayLabel(now = new Date()): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
}

/** Home screen: greeting, tag filter and the bowl of mochi notes. */
export function NotesScreen({
  notes,
  loading,
  tagFilter,
  onTagFilter,
  onOpenNote,
  onNoteMenu,
  onOpenSearch,
  onCreateNote,
  storageWarning,
}: NotesScreenProps) {
  const tags = useMemo(() => allTags(notes).slice(0, 16), [notes]);
  const linkCount = useMemo(
    () => notes.reduce((total, note) => total + extractWikiLinks(note.content).length, 0),
    [notes],
  );

  const filtered = useMemo(() => {
    if (!tagFilter) return notes;
    const key = tagFilter.toLowerCase();
    return notes.filter((note) => note.tags.some((tag) => tag.toLowerCase() === key));
  }, [notes, tagFilter]);

  const pinned = filtered.filter((note) => note.pinned);
  const rest = filtered.filter((note) => !note.pinned);

  return (
    <div className="screen notes-screen">
      <header className="screen-header notes-header">
        <div className="notes-header-top">
          <div className="notes-greeting">
            <span className="notes-greeting-mascot" aria-hidden="true">
              <Mascot variant="happy" size={54} bob />
            </span>
            <div className="notes-greeting-text">
              <p className="notes-hello">{greetingFor(new Date().getHours())}</p>
              <h1 className="notes-brand">Mochi 麻薯</h1>
            </div>
          </div>
          <button type="button" className="icon-btn notes-search-btn" aria-label="搜索麻薯" onClick={onOpenSearch}>
            <Icon name="search" size={21} />
          </button>
        </div>

        <div className="notes-stats">
          <span className="notes-stat">🍡 {notes.length} 颗麻薯</span>
          <span className="notes-stat">🔗 {linkCount} 条糖丝</span>
          <span className="notes-stat notes-stat-date">{todayLabel()}</span>
        </div>
      </header>

      {storageWarning ? (
        <div className="banner banner-warn" role="status">
          <Icon name="warn" size={16} />
          <span>{storageWarning}</span>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="chips-row" role="tablist" aria-label="按口味筛选">
          <button
            type="button"
            role="tab"
            aria-selected={tagFilter === null}
            className={`chip${tagFilter === null ? ' is-active' : ''}`}
            onClick={() => onTagFilter(null)}
          >
            全部口味
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
            <Mascot variant="sleepy" size={96} bob />
            <p className="empty-text">正在揉麻薯…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Mascot variant="sleepy" size={104} bob />
            <p className="empty-title">{tagFilter ? '这个口味还没有麻薯哦' : '还没有麻薯哦～'}</p>
            <p className="empty-text">
              {tagFilter
                ? '换一个口味看看，或者把它们都做成同一种味道。'
                : '点底部中间的 ＋ 捏一颗软乎乎的新麻薯吧，写点什么都可以呀。'}
            </p>
            {tagFilter ? (
              <button type="button" className="btn btn-ghost" onClick={() => onTagFilter(null)}>
                看看全部
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onCreateNote}>
                捏一颗麻薯
              </button>
            )}
          </div>
        ) : (
          <>
            {pinned.length > 0 ? (
              <section aria-label="置顶麻薯">
                <div className="section-label">
                  <Icon name="pin" size={13} />
                  <span>舍不得弄丢</span>
                </div>
                <div className="notes-list">
                  {pinned.map((note) => (
                    <NoteCard key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} />
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-label="全部麻薯">
              {pinned.length > 0 && rest.length > 0 ? <div className="section-label">全部麻薯</div> : null}
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
