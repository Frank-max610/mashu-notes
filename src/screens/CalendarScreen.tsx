import { useMemo, useState } from 'react';
import type { Note } from '../lib/types';
import { directoryList } from '../lib/directories';
import { dayKeyOf, noteDayKey, summarizeDay } from '../lib/insights';
import { Icon } from '../components/Icon';

export interface CalendarScreenProps {
  notes: Note[];
  onOpenNote: (id: string) => void;
  onSaveDiary: (text: string, occurredAt: number, dirId: string | null) => void;
  onCreatePlan: (title: string, dueAt: number) => void;
  onOpenDirectories: () => void;
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

function keyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseSelected(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

/** Month calendar: every day is a direct writing surface. */
export function CalendarScreen({ notes, onOpenNote, onSaveDiary, onCreatePlan, onOpenDirectories }: CalendarScreenProps) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(today));
  const [mode, setMode] = useState<'diary' | 'plan'>('diary');
  const [draft, setDraft] = useState('');
  const [dirId, setDirId] = useState<string>('');

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) {
      if (note.meta.directory || note.archivedAt) continue;
      const key = noteDayKey(note);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string; day: number } | null> = [];
    for (let i = 0; i < mondayOffset; i += 1) cells.push(null);
    for (let day = 1; day <= days; day += 1) cells.push({ key: keyOf(year, month, day), day });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const selectedDate = useMemo(() => parseSelected(selectedKey), [selectedKey]);
  const selectedNotes = useMemo(
    () => notes.filter((note) => noteDayKey(note) === selectedKey && !note.meta.directory && !note.archivedAt),
    [notes, selectedKey],
  );
  const summary = useMemo(() => summarizeDay(selectedNotes), [selectedNotes]);
  const directories = useMemo(() => directoryList(notes), [notes]);
  const isToday = selectedKey === dayKeyOf(today);

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    if (mode === 'plan') {
      onCreatePlan(text, selectedDate.getTime());
    } else {
      const occurredAt = isToday ? Date.now() : selectedDate.getTime();
      onSaveDiary(text, occurredAt, dirId || null);
    }
    setDraft('');
  };

  return (
    <div className="screen calendar-screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">{cursor.getFullYear()}年{cursor.getMonth() + 1}月</h1>
          <p className="brand-date">每天写一点，日历会替你记住</p>
        </div>
        <div className="calendar-nav">
          <button type="button" className="icon-btn" aria-label="上个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <Icon name="chevronDown" size={17} />
          </button>
          <button type="button" className="icon-btn calendar-today" aria-label="回到今天" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedKey(dayKeyOf(today)); }}>
            今
          </button>
          <button type="button" className="icon-btn" aria-label="下个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <Icon name="chevronDown" size={17} />
          </button>
        </div>
      </header>

      <div className="screen-body calendar-body">
        <div className="calendar-week">
          {WEEK.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid">
          {grid.map((cell, index) =>
            cell === null ? <span key={`empty-${index}`} className="calendar-cell is-empty" /> : (
              <button
                key={cell.key}
                type="button"
                className={`calendar-cell${cell.key === selectedKey ? ' is-selected' : ''}${cell.key === dayKeyOf(today) ? ' is-today' : ''}`}
                aria-label={`${cell.day}日，${byDay.get(cell.key) ?? 0}条记录`}
                onClick={() => setSelectedKey(cell.key)}
              >
                <span className="calendar-day">{cell.day}</span>
                {(byDay.get(cell.key) ?? 0) > 0 ? <span className="calendar-dot" /> : null}
              </button>
            ),
          )}
        </div>

        <section className="calendar-day-panel">
          <div className="calendar-day-head">
            <h2 className="review-title">{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日{isToday ? ' · 今天' : ''}</h2>
            <span className="muted small">{selectedNotes.length} 条记录{summary.spend ? ` · ${summary.spend} 元` : ''}</span>
          </div>

          <div className="calendar-compose" aria-label="写这一天">
            <div className="calendar-modes" role="group" aria-label="写入类型">
              <button type="button" className={`chip${mode === 'diary' ? ' is-active' : ''}`} aria-pressed={mode === 'diary'} onClick={() => setMode('diary')}>日记</button>
              <button type="button" className={`chip${mode === 'plan' ? ' is-active' : ''}`} aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>计划</button>
              {directories.length > 0 && mode === 'diary' ? (
                <select className="directory-select calendar-dir" value={dirId} aria-label="放进目录" onChange={(event) => setDirId(event.target.value)}>
                  <option value="">未分类</option>
                  {directories.map((directory) => <option key={directory.id} value={directory.id}>{directory.title}</option>)}
                </select>
              ) : null}
            </div>
            <textarea
              className="calendar-compose-input"
              aria-label="写这一天"
              rows={3}
              value={draft}
              placeholder={mode === 'plan' ? '给这一天加一个计划…' : isToday ? '今天发生了什么…' : `补写 ${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日…`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="calendar-compose-foot">
              <button type="button" className="link-btn" onClick={onOpenDirectories}>管理目录</button>
              <button type="button" className="btn btn-primary calendar-save" onClick={save} disabled={!draft.trim()}>
                {mode === 'plan' ? '加计划' : '保存'}
              </button>
            </div>
          </div>

          {selectedNotes.length > 0 ? (
            <div className="calendar-entries">
              {selectedNotes.map((note) => (
                <button key={note.id} type="button" className="calendar-entry" onClick={() => onOpenNote(note.id)}>
                  <span className={`calendar-entry-dot kind-${note.kind}`} />
                  <span className="calendar-entry-main">
                    <span className="calendar-entry-title">{note.title}</span>
                    <span className="calendar-entry-meta">{note.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ') || '记录'}</span>
                  </span>
                  <Icon name="arrowRight" size={14} />
                </button>
              ))}
            </div>
          ) : <p className="muted small calendar-empty">这一天还没有记录，从上面写第一条。</p>}
        </section>
      </div>
    </div>
  );
}
