import { useMemo, useState } from 'react';
import type { Note } from '../lib/types';
import { Icon } from '../components/Icon';

export interface PlanScreenProps {
  notes: Note[];
  onCreate: (title: string) => void;
  onToggleStatus: (note: Note) => void;
  onOpenNote: (id: string) => void;
  onDelete: (note: Note) => void;
}

const STATUS_LABEL = { todo: '待开始', doing: '进行中', done: '已完成' } as const;
const ORDER = ['doing', 'todo', 'done'] as const;

function dueText(dueAt?: number): string {
  if (!dueAt) return '';
  const date = new Date(dueAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 计划 — goals and to-dos stored as notes with meta.plan. */
export function PlanScreen({ notes, onCreate, onToggleStatus, onOpenNote, onDelete }: PlanScreenProps) {
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'doing' | 'done'>('all');
  const plans = useMemo(
    () =>
      notes
        .filter((note) => note.meta.plan && !note.archivedAt)
        .sort((a, b) => (a.meta.plan!.dueAt ?? Infinity) - (b.meta.plan!.dueAt ?? Infinity)),
    [notes],
  );
  const filtered = filter === 'all' ? plans : plans.filter((note) => note.meta.plan?.status === filter);
  const active = plans.filter((note) => note.meta.plan?.status !== 'done').length;

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    onCreate(title);
    setDraft('');
  };

  return (
    <div className="screen plan-screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">计划</h1>
          <p className="brand-date">{active > 0 ? `${active} 件在进行中` : '给自己一件想做的事'}</p>
        </div>
      </header>
      <div className="screen-body">
        <div className="plan-add">
          <input
            className="field-input"
            value={draft}
            placeholder="加一个目标或待办…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!draft.trim()}>
            添加
          </button>
        </div>

        <div className="filter-bar plan-filter" role="tablist" aria-label="计划筛选">
          {(['all', 'doing', 'todo', 'done'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`chip${filter === key ? ' is-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'all' ? `全部 ${plans.length}` : STATUS_LABEL[key]}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <Icon name="checkbox" size={24} />
            <p className="empty-title">{plans.length === 0 ? '还没有计划' : '这个状态没有计划'}</p>
            <p className="empty-text">先写下一件想完成的小事。</p>
          </div>
        ) : (
          <div className="plan-list">
            {filtered.map((note) => {
              const plan = note.meta.plan!;
              return (
                <div className={`plan-row is-${plan.status}`} key={note.id}>
                  <button
                    type="button"
                    className="plan-check"
                    aria-label={`切换状态：${note.title}`}
                    onClick={() => onToggleStatus(note)}
                  >
                    {plan.status === 'done' ? <Icon name="check" size={15} /> : null}
                  </button>
                  <button type="button" className="plan-main" onClick={() => onOpenNote(note.id)}>
                    <span className="plan-title">{note.title || '未命名计划'}</span>
                    <span className="plan-meta">
                      {STATUS_LABEL[plan.status]}
                      {plan.dueAt ? ` · ${dueText(plan.dueAt)}` : ''}
                    </span>
                  </button>
                  <span className={`plan-status is-${plan.status}`}>
                    {ORDER.includes(plan.status) ? STATUS_LABEL[plan.status] : ''}
                  </span>
                  <button type="button" className="record-more" aria-label={`删除计划：${note.title}`} onClick={() => onDelete(note)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
