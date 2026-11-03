import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Note } from '../lib/types';
import { allTags } from '../lib/links';
import { formatRelativeTime } from '../lib/format';
import { searchNotes } from '../lib/search';
import { Icon } from './Icon';
import { Mascot } from './Mascot';
import './SearchScreen.css';

export interface SearchScreenProps {
  notes: Note[];
  onOpenNote: (id: string) => void;
}

/** Query tokens eligible for <mark> highlighting (tag filters excluded). */
function highlightTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.startsWith('#'))
    .map((token) => token.toLowerCase());
}

/** Tags (#work) currently typed in the query, used to light up the chips. */
function activeTagKeys(query: string): Set<string> {
  const keys = new Set<string>();
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (token.startsWith('#') && token.length > 1) keys.add(token.slice(1));
  }
  return keys;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight query tokens without `dangerouslySetInnerHTML`: `String.split`
 * with a capturing regex alternates plain text and matches, which we map to
 * React nodes. Longer tokens are tried first so overlapping ones prefer the
 * most specific match.
 */
function highlight(text: string, tokens: string[]): ReactNode {
  const unique = [...new Set(tokens.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return text;
  const pattern = new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part,
  );
}

/** Full-text search screen: a pastel pill search box, tag chips and result cards. */
export function SearchScreen({ notes, onOpenNote }: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const idle = query.trim().length === 0;
  const hits = useMemo(() => searchNotes(notes, query), [notes, query]);
  const tags = useMemo(() => allTags(notes), [notes]);
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const marks = useMemo(() => highlightTokens(query), [query]);
  const activeTags = useMemo(() => activeTagKeys(query), [query]);

  // A new query starts a new result list; jump back to the top so the best
  // match is visible while typing.
  useEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const handleClear = (): void => {
    setQuery('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Ignore keys that belong to an IME composition session.
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Escape') {
      if (query.length > 0) {
        event.preventDefault();
        setQuery('');
        inputRef.current?.focus();
      }
      return;
    }

    if (event.key === 'Enter') {
      const target = event.target as HTMLElement;
      // Let buttons handle their own Enter activation.
      if (target.tagName === 'BUTTON') return;
      const first = hits[0];
      if (first) {
        event.preventDefault();
        onOpenNote(first.id);
      }
    }
  };

  return (
    <div className="screen search-screen" onKeyDown={handleKeyDown}>
      <header className="screen-header search-screen__header">
        <div className="search-screen__title-row">
          <div className="search-screen__title-block">
            <h1 className="search-screen__title">搜索</h1>
            <p className="search-screen__subtitle">在麻薯堆里翻翻看～</p>
          </div>
          {idle ? (
            <Icon name="flower" size={24} className="search-screen__header-flower" />
          ) : (
            <span className="search-screen__count-pill" aria-live="polite">
              <Icon name="sparkles" size={13} />
              {hits.length} 颗麻薯
            </span>
          )}
        </div>

        <div className="search-screen__searchbar">
          <span className="search-screen__search-badge" aria-hidden="true">
            <Icon name="search" size={17} />
          </span>
          <input
            ref={inputRef}
            className="search-screen__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、正文或 #标签"
            aria-label="搜索笔记"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query.length > 0 ? (
            <button
              type="button"
              className="search-screen__clear"
              aria-label="清除搜索"
              onClick={handleClear}
            >
              <Icon name="close" size={17} />
            </button>
          ) : null}
        </div>

        {tags.length > 0 ? (
          <div className="search-screen__tags" role="group" aria-label="按标签筛选">
            {tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                className={`chip search-screen__tag${activeTags.has(tag.tag) ? ' is-active' : ''}`}
                onClick={() => {
                  // Filter in place: jumping to the notes list here would make
                  // the active-chip state below unreachable.
                  setQuery(`#${tag.label}`);
                }}
              >
                <Icon name="hash" size={11} />
                <span>{tag.label}</span>
                <span className="chip-count">{tag.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div ref={resultsRef} className="search-screen__results scroll-area">
        {idle ? (
          <div className="section-label search-screen__section-label">
            <Icon name="clock" size={13} />
            <span>最近编辑</span>
            <Icon name="heart" size={12} className="search-screen__section-heart" />
          </div>
        ) : null}

        {hits.length === 0 ? (
          <div className="empty search-screen__empty">
            <Mascot variant={idle ? 'happy' : 'sleepy'} size={92} bob />
            <p className="empty-title">{idle ? '还没有麻薯呢' : '没找到这颗麻薯呀～'}</p>
            <p className="empty-text">
              {idle
                ? '先捏一颗新麻薯，再回来搜索吧。'
                : '换个关键词试试，或者用 #标签 找找看。'}
            </p>
          </div>
        ) : (
          <ul className="search-screen__list" aria-label="搜索结果">
            {hits.map((hit) => {
              const note = noteById.get(hit.id);
              const noteTags = note ? note.tags.slice(0, 2) : [];
              return (
                <li key={hit.id} className="search-screen__list-item">
                  <button
                    type="button"
                    className="search-screen__item"
                    aria-label={`打开笔记：${hit.title || '未命名笔记'}`}
                    onClick={() => onOpenNote(hit.id)}
                  >
                    <span className="search-screen__item-top">
                      <span className="search-screen__item-title">
                        {hit.title.trim() || '未命名笔记'}
                      </span>
                      <span className="search-screen__item-time">
                        <Icon name="clock" size={11} />
                        {note ? formatRelativeTime(note.updatedAt) : ''}
                      </span>
                    </span>
                    {hit.snippet ? (
                      <span className="search-screen__snippet">
                        {highlight(hit.snippet, marks)}
                      </span>
                    ) : null}
                    {noteTags.length > 0 ? (
                      <span className="search-screen__item-tags">
                        {noteTags.map((tag) => (
                          <span key={tag} className="search-screen__tag-pill">
                            #{tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
