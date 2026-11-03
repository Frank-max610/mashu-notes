import { useMemo, useState } from 'react';
import type { Note, NoteKind } from '../lib/types';
import { KIND_INFO, NOTE_KINDS, formatAmount } from '../lib/kinds';
import { dayKeyOf, noteDayKey, summarizeDay } from '../lib/insights';
import { NoteCard } from '../components/NoteCard';
import { Icon } from '../components/Icon';
import { isIosDevice, isStandaloneMode } from '../components/IosInstallCard';

export type KindFilter = NoteKind | 'all';

export interface NotesScreenProps {
  notes: Note[];
  loading: boolean;
  kindFilter: KindFilter;
  onKindFilter: (kind: KindFilter) => void;
  onOpenNote: (id: string) => void;
  onNoteMenu: (note: Note) => void;
  onOpenSearch: () => void;
  onQuickCapture: (kind?: NoteKind) => void;
  onOpenAgent: () => void;
  onOpenSettings: () => void;
  storageWarning: string | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function todayLabel(now = new Date()): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
}

function daySectionLabel(dayKey: string, now = new Date()): string {
  const todayKey = dayKeyOf(now);
  if (dayKey === todayKey) return '今天';
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey === dayKeyOf(yesterday)) return '昨天';
  const [, month, day] = dayKey.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

/** Home: daily overview, quick capture and the calm record list. */
export function NotesScreen({
  notes,
  loading,
  kindFilter,
  onKindFilter,
  onOpenNote,
  onNoteMenu,
  onOpenSearch,
  onQuickCapture,
  onOpenAgent,
  onOpenSettings,
  storageWarning,
}: NotesScreenProps) {
  const today = useMemo(() => summarizeDay(notes), [notes]);
  const [showInstallHint, setShowInstallHint] = useState(() => {
    try {
      if (localStorage.getItem('mochi.installHint.v1') === '1') return false;
    } catch {
      /* ignore */
    }
    return isIosDevice() && !isStandaloneMode();
  });

  const dismissInstallHint = () => {
    try {
      localStorage.setItem('mochi.installHint.v1', '1');
    } catch {
      /* ignore */
    }
    setShowInstallHint(false);
  };

  const filtered = useMemo(() => {
    if (kindFilter === 'all') return notes;
    return notes.filter((note) => note.kind === kindFilter);
  }, [notes, kindFilter]);

  const pinned = filtered.filter((note) => note.pinned);
  const rest = filtered.filter((note) => !note.pinned);

  const groups = useMemo(() => {
    const buckets = new Map<string, Note[]>();
    for (const note of rest) {
      const key = noteDayKey(note);
      const list = buckets.get(key);
      if (list) list.push(note);
      else buckets.set(key, [note]);
    }
    return [...buckets.entries()];
  }, [rest]);

  const overviewItems = [
    { label: '支出', value: today.spend > 0 ? `¥${formatAmount(today.spend)}` : '—' },
    { label: '摄入 kcal', value: today.calories > 0 ? `${Math.round(today.calories)}` : '—' },
    { label: '睡眠 h', value: today.sleep !== undefined ? formatAmount(today.sleep) : '—' },
    { label: '记录', value: `${today.recordCount} 条` },
  ];

  return (
    <div className="screen notes-screen">
      <header className="screen-header notes-header">
        <div className="notes-header-top">
          <div className="notes-brand-wrap">
            <span className="notes-mark" aria-hidden="true">
              麻
            </span>
            <div className="notes-brand-text">
              <h1 className="notes-brand">麻薯</h1>
              <p className="notes-subtitle">本地生活记录 · {todayLabel()}</p>
            </div>
          </div>
          <div className="notes-header-actions">
            <button type="button" className="icon-btn" aria-label="搜索" onClick={onOpenSearch}>
              <Icon name="search" size={20} />
            </button>
          </div>
        </div>

        <section className="today-card" aria-label="今日概览">
          <div className="today-card-head">
            <div className="today-card-title">今天</div>
            <button type="button" className="today-agent" onClick={onOpenAgent}>
              <Icon name="sparkles" size={15} />
              问问助手
            </button>
          </div>

          <div className="today-stats">
            {overviewItems.map((item) => (
              <div key={item.label} className="today-stat">
                <span className="today-stat-label">{item.label}</span>
                <span className="today-stat-value">{item.value}</span>
              </div>
            ))}
          </div>

          <div className="today-actions">
            <button type="button" className="today-action is-primary" onClick={() => onQuickCapture('food')}>
              记饮食
            </button>
            <button type="button" className="today-action" onClick={() => onQuickCapture('health')}>
              记健康
            </button>
            <button type="button" className="today-action" onClick={() => onQuickCapture('finance')}>
              记一笔
            </button>
            <button type="button" className="today-action" onClick={() => onQuickCapture('diary')}>
              写日记
            </button>
          </div>
        </section>
      </header>

      {showInstallHint ? (
        <div className="install-hint" role="note">
          <Icon name="external" size={15} />
          <span className="install-hint-text">添加到主屏幕后，断网也能记</span>
          <button type="button" className="install-hint-action" onClick={onOpenSettings}>
            怎么装
          </button>
          <button
            type="button"
            className="install-hint-dismiss"
            aria-label="不再提示"
            onClick={dismissInstallHint}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}

      {storageWarning ? (
        <div className="banner banner-warn" role="status">
          <Icon name="warn" size={16} />
          <span>{storageWarning}</span>
        </div>
      ) : null}

      <div className="kind-chips" role="tablist" aria-label="按类型筛选">
        <button
          type="button"
          role="tab"
          aria-selected={kindFilter === 'all'}
          className={`chip${kindFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => onKindFilter('all')}
        >
          全部
        </button>
        {NOTE_KINDS.filter((kind) => kind !== 'note').map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kindFilter === kind}
            className={`chip kind-chip${kindFilter === kind ? ' is-active' : ''}`}
            style={{ ['--kind-accent' as string]: `var(${KIND_INFO[kind].accentVar})`, ['--kind-soft' as string]: `var(${KIND_INFO[kind].accentSoftVar})` }}
            onClick={() => onKindFilter(kind)}
          >
            <span aria-hidden="true">{KIND_INFO[kind].emoji}</span>
            {KIND_INFO[kind].label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={kindFilter === 'note'}
          className={`chip kind-chip${kindFilter === 'note' ? ' is-active' : ''}`}
          style={{ ['--kind-accent' as string]: `var(${KIND_INFO.note.accentVar})`, ['--kind-soft' as string]: `var(${KIND_INFO.note.accentSoftVar})` }}
          onClick={() => onKindFilter('note')}
        >
          笔记
        </button>
      </div>

      <div className="screen-body">
        {loading && notes.length === 0 ? (
          <div className="empty">
            <div className="spinner" />
            <p className="empty-text">正在打开本地记录…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Icon name="book" size={30} />
            <p className="empty-title">{kindFilter === 'all' ? '还没有记录' : '这个分类还没有内容'}</p>
            <p className="empty-text">
              {kindFilter === 'all'
                ? '用一句话记下今天：吃了什么、睡了多久、花了多少。'
                : '切换分类看看，或者现在记一笔。'}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => onQuickCapture()}>
              记一笔
            </button>
          </div>
        ) : (
          <>
            {pinned.length > 0 ? (
              <section aria-label="置顶">
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

            {groups.map(([dayKey, dayNotes]) => (
              <section key={dayKey} aria-label={daySectionLabel(dayKey)}>
                <div className="section-label">{daySectionLabel(dayKey)}</div>
                <div className="notes-list">
                  {dayNotes.map((note) => (
                    <NoteCard key={note.id} note={note} onOpen={onOpenNote} onMenu={onNoteMenu} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
