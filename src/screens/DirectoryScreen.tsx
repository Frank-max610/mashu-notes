import { useMemo, useState } from 'react';
import type { Note } from '../lib/types';
import { DIRECTORY_COLORS, countInDirectory, directoryColor, directoryList, notesInDirectory, unassignedNotes } from '../lib/directories';
import { Icon } from '../components/Icon';

export interface DirectoryScreenProps {
  notes: Note[];
  onCreate: (name: string, color: string) => void;
  onAssign: (noteId: string, dirId: string | null) => void;
  onDeleteDirectory: (directory: Note) => void;
  onOpenNote: (id: string) => void;
}

/** 知识库目录 — users create their own folders; notes and the graph follow them. */
export function DirectoryScreen({ notes, onCreate, onAssign, onDeleteDirectory, onOpenNote }: DirectoryScreenProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DIRECTORY_COLORS[0]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const directories = useMemo(() => directoryList(notes), [notes]);
  const unassigned = useMemo(() => unassignedNotes(notes).slice(0, 24), [notes]);

  const create = () => {
    const value = name.trim();
    if (!value) return;
    onCreate(value, color);
    setName('');
  };

  return (
    <div className="screen module-screen directory-screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">知识库目录</h1>
          <p className="brand-date">你创建几个目录，图谱就有几个分支</p>
        </div>
      </header>
      <div className="screen-body">
        <div className="directory-create">
          <input
            className="field-input"
            value={name}
            placeholder="新目录名称，例如：工作 / 阅读 / 旅行"
            maxLength={20}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
          />
          <div className="directory-colors" role="group" aria-label="目录颜色">
            {DIRECTORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={`directory-color${color === option ? ' is-active' : ''}`}
                style={{ background: option }}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color === option}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={create} disabled={!name.trim()}>
            创建目录
          </button>
        </div>

        {directories.length === 0 ? (
          <div className="empty">
            <Icon name="book" size={24} />
            <p className="empty-title">还没有目录</p>
            <p className="empty-text">创建一个目录，再把记录放进去；图谱会以目录为分支长出来。</p>
          </div>
        ) : (
          <div className="directory-list">
            {directories.map((directory) => {
              const dirNotes = notesInDirectory(notes, directory.id);
              const expanded = expandedId === directory.id;
              return (
                <div className="directory-block" key={directory.id}>
                  <div className="directory-row">
                    <span className="directory-dot" style={{ background: directoryColor(directory) }} />
                    <button
                      type="button"
                      className="directory-main"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : directory.id)}
                    >
                      <span className="directory-name">{directory.title}</span>
                      <span className="directory-meta">{countInDirectory(notes, directory.id)} 条记录 · {expanded ? '收起' : '展开'}</span>
                    </button>
                    <button type="button" className="record-more" aria-label={`删除目录 ${directory.title}`} onClick={() => onDeleteDirectory(directory)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="directory-notes">
                      {dirNotes.length === 0 ? <p className="muted small">目录还是空的，从下面未分类里移进来。</p> : null}
                      {dirNotes.map((note) => (
                        <div className="directory-note-row" key={note.id}>
                          <button type="button" className="record-main" onClick={() => onOpenNote(note.id)}>
                            <span className="record-title">{note.title}</span>
                            <span className="record-meta">{note.kind}</span>
                          </button>
                          <button type="button" className="chip" onClick={() => onAssign(note.id, null)}>移出</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {unassigned.length > 0 && directories.length > 0 ? (
          <section aria-label="未分类记录">
            <div className="section-label">未分类记录</div>
            <div className="directory-unassigned">
              {unassigned.map((note) => (
                <label className="unassigned-row" key={note.id}>
                  <span className="record-title">{note.title || '未命名记录'}</span>
                  <select
                    className="directory-select"
                    value={note.dirId ?? ''}
                    aria-label={`把 ${note.title} 移入目录`}
                    onChange={(event) => onAssign(note.id, event.target.value || null)}
                  >
                    <option value="">未分类</option>
                    {directories.map((directory) => (
                      <option key={directory.id} value={directory.id}>{directory.title}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
