import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NotePatch } from '../lib/types';
import { countWords } from '../lib/markdown';
import { Icon } from '../components/Icon';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { EditorToolbar, type EditorCommand } from '../components/EditorToolbar';
import { BacklinksPanel } from '../components/BacklinksPanel';

export interface EditorScreenProps {
  note: Note;
  notes: Note[];
  onChange: (patch: NotePatch) => void;
  onBack: () => void;
  onTogglePin: () => void;
  onMenu: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
  /** Surfaced when the debounced write failed (e.g. storage full). */
  storageWarning?: string | null;
}

type Mode = 'edit' | 'preview';

interface SuggestState {
  query: string;
  start: number;
  end: number;
}

/** Full screen note editor: edit / preview toggle, autosave, toolbar, backlinks. */
export function EditorScreen({
  note,
  notes,
  onChange,
  onBack,
  onTogglePin,
  onMenu,
  onOpenNote,
  onCreateNote,
  storageWarning,
}: EditorScreenProps) {
  const [mode, setMode] = useState<Mode>(() => (note.content.trim() ? 'preview' : 'edit'));
  const [saveLabel, setSaveLabel] = useState('已保存好 ♡');
  const [suggest, setSuggest] = useState<SuggestState | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const words = useMemo(() => countWords(note.content), [note.content]);

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    if (mode === 'edit') resizeTextarea();
  }, [mode, note.content, resizeTextarea]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const markDirty = useCallback(() => {
    setSaveLabel('正在揉…');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveLabel('已保存好 ♡'), 700);
  }, []);

  const updateContent = useCallback(
    (content: string) => {
      onChange({ content });
      markDirty();
    },
    [markDirty, onChange],
  );

  const applyCaret = useCallback(() => {
    if (pendingCaretRef.current === null) return;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(caret, caret);
      resizeTextarea();
    });
  }, [resizeTextarea]);

  const updateSuggestions = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = /\[\[([^[\]\n]*)$/.exec(before);
    if (!match) {
      setSuggest(null);
      return;
    }
    const query = match[1];
    setSuggest({ query, start: caret - query.length, end: caret });
  }, []);

  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const query = suggest.query.trim().toLowerCase();
    return notes
      .filter((candidate) => candidate.id !== note.id)
      .filter((candidate) => !query || candidate.title.toLowerCase().includes(query))
      .sort((a, b) => {
        const aPrefix = a.title.toLowerCase().startsWith(query) ? 1 : 0;
        const bPrefix = b.title.toLowerCase().startsWith(query) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, 6);
  }, [note.id, notes, suggest]);

  const insertSuggestion = useCallback(
    (title: string) => {
      if (!suggest) return;
      const current = note.content;
      const next = `${current.slice(0, suggest.start)}${title}]]${current.slice(suggest.end)}`;
      pendingCaretRef.current = suggest.start + title.length + 2;
      setSuggest(null);
      updateContent(next);
      applyCaret();
    },
    [applyCaret, note.content, suggest, updateContent],
  );

  const applyCommand = useCallback(
    (command: EditorCommand) => {
      const element = textareaRef.current;
      const current = note.content;
      const start = element?.selectionStart ?? current.length;
      const end = element?.selectionEnd ?? current.length;
      const selected = current.slice(start, end);

      let next = current;
      let selectionStart = start;
      let selectionEnd = end;

      const wrap = (before: string, after: string, placeholder: string) => {
        const text = selected || placeholder;
        next = current.slice(0, start) + before + text + after + current.slice(end);
        selectionStart = start + before.length;
        selectionEnd = selectionStart + text.length;
      };

      const prefixLines = (prefix: string, placeholder: string) => {
        const lineStart = current.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const segment = selected || placeholder;
        const replaced = segment
          .split('\n')
          .map((line) => `${prefix}${line}`)
          .join('\n');
        next = current.slice(0, lineStart) + replaced + current.slice(end);
        selectionStart = lineStart;
        selectionEnd = lineStart + replaced.length;
      };

      const insertBlock = (block: string) => {
        const leading = start > 0 && current[start - 1] !== '\n' ? '\n' : '';
        next = current.slice(0, start) + leading + block + current.slice(end);
        selectionStart = start + leading.length;
        selectionEnd = selectionStart + block.length;
      };

      switch (command) {
        case 'bold':
          wrap('**', '**', '粗体');
          break;
        case 'italic':
          wrap('*', '*', '斜体');
          break;
        case 'heading':
          prefixLines('## ', '标题');
          break;
        case 'list':
          prefixLines('- ', '列表项');
          break;
        case 'task':
          prefixLines('- [ ] ', '待办');
          break;
        case 'quote':
          prefixLines('> ', '引用');
          break;
        case 'code':
          insertBlock(`\`\`\`\n${selected || '代码'}\n\`\`\``);
          break;
        case 'link':
          wrap('[', '](https://)', '链接文字');
          break;
        case 'wiki':
          wrap('[[', ']]', '笔记名');
          break;
        case 'divider':
          insertBlock('---\n');
          break;
        default:
          return;
      }

      pendingCaretRef.current = selectionStart;
      setSuggest(null);
      updateContent(next);
      if (element) {
        requestAnimationFrame(() => {
          element.focus();
          element.setSelectionRange(selectionStart, selectionEnd);
          resizeTextarea();
        });
        pendingCaretRef.current = null;
      }
    },
    [note.content, resizeTextarea, updateContent],
  );

  return (
    <div className="screen editor-screen">
      <header className="editor-header">
        <button type="button" className="icon-btn" aria-label="返回笔记列表" onClick={onBack}>
          <Icon name="back" size={22} />
        </button>
        <div className="editor-header-meta">
          <span className={`editor-status${storageWarning ? ' is-error' : ''}`}>
            {storageWarning ? '没保存成功' : saveLabel}
          </span>
          <span className="editor-dot" aria-hidden="true">
            ·
          </span>
          <span className="editor-status">{words} 字</span>
          {note.pinned ? (
            <>
              <span className="editor-dot" aria-hidden="true">
                ·
              </span>
              <span className="editor-status editor-status-accent">已置顶</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={mode === 'edit' ? '切换到预览' : '切换到编辑'}
          onClick={() => {
            setMode(mode === 'edit' ? 'preview' : 'edit');
            setSuggest(null);
          }}
        >
          <Icon name={mode === 'edit' ? 'eye' : 'edit'} size={21} />
        </button>
        <button
          type="button"
          className={`icon-btn${note.pinned ? ' is-on' : ''}`}
          aria-pressed={note.pinned}
          aria-label={note.pinned ? '取消置顶' : '置顶笔记'}
          onClick={onTogglePin}
        >
          <Icon name="pin" size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label="更多操作" onClick={onMenu}>
          <Icon name="more" size={20} />
        </button>
      </header>

      <div className="editor-body scroll-area">
        {mode === 'edit' ? (
          <>
            <input
              ref={titleRef}
              className="editor-title-input"
              value={note.title}
              placeholder="给这颗麻薯起个名字…"
              aria-label="笔记标题"
              onChange={(event) => {
                onChange({ title: event.target.value });
                markDirty();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  textareaRef.current?.focus();
                }
              }}
            />
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={note.content}
              placeholder="写点什么都可以呀～支持 Markdown，用 [[名字]] 把麻薯串起来 ♡"
              aria-label="笔记正文"
              spellCheck={false}
              onChange={(event) => {
                const value = event.target.value;
                updateContent(value);
                updateSuggestions(value, event.target.selectionStart ?? value.length);
              }}
              onBlur={() => setSuggest(null)}
            />
          </>
        ) : (
          <>
            <h1 className="preview-title">{note.title || '未命名笔记'}</h1>
            <MarkdownPreview
              note={note}
              notes={notes}
              onOpenNote={onOpenNote}
              onCreateNote={onCreateNote}
            />
            {note.content.trim() ? null : (
              <p className="muted editor-empty-hint">这颗麻薯还是空的，切到编辑写点什么吧 ♡</p>
            )}
          </>
        )}

        <div className="editor-links">
          <BacklinksPanel
            note={note}
            notes={notes}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </div>
      </div>

      {mode === 'edit' ? (
        <>
          {suggest && suggestions.length > 0 ? (
            <div className="link-suggest" role="listbox" aria-label="链接建议">
              <span className="link-suggest-label">串到：</span>
              {suggestions.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="chip"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => insertSuggestion(candidate.title)}
                >
                  {candidate.title}
                </button>
              ))}
            </div>
          ) : null}
          <EditorToolbar onCommand={applyCommand} />
        </>
      ) : null}
    </div>
  );
}
