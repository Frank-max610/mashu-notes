import { useState } from 'react';
import type { Note } from '../lib/types';
import { directoryColor, notesInDirectory } from '../lib/directories';
import { Icon } from '../components/Icon';

export interface DirectoryDetailScreenProps {
  directory: Note;
  notes: Note[];
  onBack: () => void;
  onOpenNote: (id: string) => void;
  /** Write a new piece of content straight into this directory. */
  onSaveContent: (text: string) => void;
  onDeleteDirectory: () => void;
}

/** A directory's content lives here — the graph ball is only its index. */
export function DirectoryDetailScreen({ directory, notes, onBack, onOpenNote, onSaveContent, onDeleteDirectory }: DirectoryDetailScreenProps) {
  const members = notesInDirectory(notes, directory.id);
  const color = directoryColor(directory);
  const [draft, setDraft] = useState('');

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    onSaveContent(text);
    setDraft('');
  };

  return (
    <div className="screen module-screen directory-detail">
      <header className="screen-header directory-detail-head">
        <button type="button" className="icon-btn" aria-label="返回知识库目录" onClick={onBack}>
          <Icon name="back" size={19} />
        </button>
        <div className="directory-detail-title">
          <span className="directory-dot" style={{ background: color }} />
          <div>
            <h1 className="page-title">{directory.title}</h1>
            <p className="brand-date">{members.length} 条内容 · 一个小球就是一个目录</p>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="删除目录"
          onClick={() => {
            if (window.confirm(`删除目录「${directory.title}」？里面的记录会保留，只是移出目录。`)) {
              onDeleteDirectory();
            }
          }}
        >
          <Icon name="trash" size={18} />
        </button>
      </header>

      <div className="screen-body directory-detail-body">
        <section className="directory-composer" aria-label={`在${directory.title}里写作`}>
          <textarea
            className="directory-composer-input"
            aria-label={`在${directory.title}里写点什么`}
            value={draft}
            autoFocus
            rows={4}
            placeholder={`在「${directory.title}」里写点什么…`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                save();
              }
            }}
          />
          <div className="directory-composer-foot">
            <span className="directory-composer-hint">直接写，保存后就会出现在这个目录和图谱里</span>
            <button type="button" className="btn btn-primary directory-composer-save" onClick={save} disabled={!draft.trim()}>
              保存
            </button>
          </div>
        </section>

        {members.length === 0 ? (
          <p className="directory-empty-hint">还没有内容。从上面写第一条，目录就会开始生长。</p>
        ) : (
          <div className="directory-detail-list">
            {members.map((note) => (
              <button
                key={note.id}
                type="button"
                className="directory-detail-row"
                onClick={() => onOpenNote(note.id)}
              >
                <span className="directory-detail-mark" style={{ background: color }} />
                <span className="directory-detail-main">
                  <span className="directory-detail-name">{note.title || '未命名记录'}</span>
                  <span className="directory-detail-meta">
                    {note.tags.length > 0 ? note.tags.map((tag) => `#${tag}`).join(' ') : '记录'}
                  </span>
                </span>
                <Icon name="arrowRight" size={15} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
