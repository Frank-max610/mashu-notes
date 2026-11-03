import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Note } from '../lib/types';
import { allTags } from '../lib/links';
import { formatRelativeTime } from '../lib/format';
import { searchNotes } from '../lib/search';
import { Icon } from './Icon';
import './SearchScreen.css';

export interface SearchScreenProps {
  notes: Note[];
  onOpenNote: (id: string) => void;
  onOpenTag: (tag: string) => void;
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

/** Full-text search screen: query box, tag chips, ranked result cards. */
export function SearchScreen({ notes, onOpenNote, onOpenTag }: SearchScreenProps) {
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
          <h1 className="app-title search-screen__title">搜索</h1>
          {!idle ? (
            <span className="search-screen__count" aria-live="polite">
              {hits.length} 条结果
            </span>
          ) : null}
        </div>

        <div className="search-screen__searchbar">
          <Icon name="search" size={18} className="search-screen__search-icon" />
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
              <Icon name="close" size={18} />
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
                  setQuery(`#${tag.label}`);
                  onOpenTag(tag.label);
                }}
              >
                <Icon name="hash" size={12} />
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
          </div>
        ) : null}

        {hits.length === 0 ? (
          <div className="empty search-screen__empty">
            <Icon name={idle ? 'book' : 'search'} size={32} />
            <p className="empty-title">{idle ? '还没有笔记' : '无匹配结果'}</p>
            <p className="empty-text">
              {idle
                ? '创建第一条笔记后，这里会列出最近编辑的内容。'
                : '换个关键词试试，或输入 #标签 按标签筛选。'}
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
                    <span className="search-screen__item-title">
                      {hit.title.trim() || '未命名笔记'}
                    </span>
                    {hit.snippet ? (
                      <span className="search-screen__snippet">{highlight(hit.snippet, marks)}</span>
                    ) : null}
                    <span className="search-screen__meta">
                      <span className="search-screen__time">
                        {note ? formatRelativeTime(note.updatedAt) : ''}
                      </span>
                      {noteTags.length > 0 ? (
                        <span className="search-screen__item-tags">
                          {noteTags.map((tag) => (
                            <span key={tag} className="search-screen__tag-pill">
                              #{tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
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
