import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Note } from '../lib/types';
import { allTags } from '../lib/links';
import { searchNotes } from '../lib/search';
import { Icon } from './Icon';
import { RecordRow } from './RecordRow';
import './SearchScreen.css';

export interface SearchScreenProps {
  /** Leave search (back to the records list). */
  onClose?: () => void;
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
export function SearchScreen({ notes, onOpenNote, onClose }: SearchScreenProps) {
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
      <header className="search-header">
        <div className="search-title-row">
          <h1 className="page-title">搜索</h1>
          {onClose ? (
            <button type="button" className="icon-btn" aria-label="关闭搜索" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          ) : null}
        </div>
        <div className="search-bar">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="search-input"
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
            <button type="button" className="search-clear" aria-label="清除搜索" onClick={handleClear}>
              <Icon name="close" size={17} />
            </button>
          ) : null}
        </div>
        {tags.length > 0 ? (
          <div className="search-tags" role="group" aria-label="按标签筛选">
            {tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                className={`chip search-tag${activeTags.has(tag.tag) ? ' is-active' : ''}`}
                onClick={() => setQuery(`#${tag.label}`)}
              >
                #{tag.label}
                <span className="chip-count">{tag.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div ref={resultsRef} className="screen-body search-results">
        {idle ? (
          <h2 className="records-group-title">最近编辑</h2>
        ) : (
          <p className="search-count">{hits.length} 条结果</p>
        )}

        {hits.length === 0 ? (
          <div className="empty">
            <Icon name="search" size={24} />
            <p className="empty-title">{idle ? '还没有内容' : '未找到相关记录'}</p>
            <p className="empty-text">
              {idle ? '先记一条，再回来搜索。' : '换个关键词试试，或者清除筛选。'}
            </p>
            {!idle ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={handleClear}>
                清除筛选
              </button>
            ) : null}
          </div>
        ) : (
          <div className="record-list">
            {hits.map((hit) => {
              const note = noteById.get(hit.id);
              if (!note) return null;
              return (
                <RecordRow
                  key={hit.id}
                  note={note}
                  onOpen={onOpenNote}
                  onMenu={() => undefined}
                  hideMenu
                  showDate
                  snippet={!idle && hit.snippet ? highlight(hit.snippet, marks) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
