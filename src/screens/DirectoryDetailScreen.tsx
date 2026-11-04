import type { Note } from '../lib/types';
import { directoryColor, notesInDirectory } from '../lib/directories';
import { Icon } from '../components/Icon';

export interface DirectoryDetailScreenProps {
  directory: Note;
  notes: Note[];
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onAdd: () => void;
  onDeleteDirectory: () => void;
}

/** A directory's content lives here — the graph ball is only its index. */
export function DirectoryDetailScreen({ directory, notes, onBack, onOpenNote, onAdd, onDeleteDirectory }: DirectoryDetailScreenProps) {
  const members = notesInDirectory(notes, directory.id);
  const color = directoryColor(directory);

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
        {members.length === 0 ? (
          <div className="empty">
            <Icon name="book" size={24} />
            <p className="empty-title">目录里还没有内容</p>
            <p className="empty-text">点下面的「记一笔」，记下的内容会直接放进这个目录，并出现在图谱里。</p>
          </div>
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

      <div className="directory-detail-foot">
        <button type="button" className="btn btn-primary directory-add" onClick={onAdd}>
          <Icon name="plus" size={17} /> 记一笔放进「{directory.title}」
        </button>
      </div>
    </div>
  );
}
