import { useMemo, useState } from 'react';
import type { Note, NoteKind } from '../lib/types';
import { KIND_INFO, describeMeta } from '../lib/kinds';
import { dayKeyOf, noteDayKey, formatMoney, type DaySummary } from '../lib/insights';
import type { DailyBrief } from '../lib/brief';
import { MochiNode } from '../components/MochiNode';
import { Sparkline } from '../components/Sparkline';
import { Icon } from '../components/Icon';
import { dismissInstallHint, isInstallHintDismissed } from '../lib/prefs';
import { isIosDevice, isStandaloneMode } from '../components/IosInstallCard';

export interface TodayScreenProps {
  notes: Note[];
  brief: DailyBrief;
  range: DaySummary[];
  onOpenNote: (id: string) => void;
  onQuickCapture: (kind?: NoteKind) => void;
  onOpenRecords: () => void;
  onOpenAgent: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  storageWarning: string | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const QUICK: ReadonlyArray<{ kind: NoteKind; label: string }> = [
  { kind: 'food', label: '饮食' },
  { kind: 'health', label: '健康' },
  { kind: 'finance', label: '收支' },
  { kind: 'diary', label: '日记' },
];

function dateLabel(now = new Date()): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function timeLabel(note: Note): string {
  const ts = note.meta.occurredAt ?? note.createdAt;
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function streakDays(notes: Note[]): number {
  const days = new Set(notes.map((note) => noteDayKey(note)));
  const cursor = new Date();
  if (!days.has(dayKeyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKeyOf(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 今日 · the quiet daily cockpit (design doc §06). */
export function TodayScreen({
  notes,
  brief,
  range,
  onOpenNote,
  onQuickCapture,
  onOpenRecords,
  onOpenAgent,
  onOpenSearch,
  onOpenSettings,
  storageWarning,
}: TodayScreenProps) {
  const [showInstallHint, setShowInstallHint] = useState(
    () => !isInstallHintDismissed() && isIosDevice() && !isStandaloneMode(),
  );
  const [showFullReview, setShowFullReview] = useState(false);

  const todayNotes = useMemo(() => {
    const key = dayKeyOf(new Date());
    return notes
      .filter((note) => noteDayKey(note) === key)
      .sort((a, b) => (b.meta.occurredAt ?? b.createdAt) - (a.meta.occurredAt ?? a.createdAt));
  }, [notes]);

  const streak = useMemo(() => streakDays(notes), [notes]);

  const series = useMemo(() => {
    const last = range.slice(-7);
    return {
      spend: last.map((day) => day.spend),
      sleep: last.map((day) => (day.sleep ?? 0)),
      records: last.map((day) => day.recordCount),
    };
  }, [range]);

  const trends = brief.trends;
  const noData = notes.length === 0;

  return (
    <div className="screen today-screen">
      <header className="screen-header today-header">
        <div className="today-date">
          <MochiNode size={26} />
          <div>
            <p className="today-date-main">{dateLabel()}</p>
            <p className="today-date-sub">麻薯 · 今天</p>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="搜索" onClick={onOpenSearch}>
          <Icon name="search" size={20} />
        </button>
      </header>

      <div className="screen-body today-body">
        <section className="today-hero rise-in" aria-label="今天">
          <h1 className="hero-greeting">{greeting()}。</h1>
          <p className="hero-question">今天发生了什么？</p>
          <p className="hero-sub">
            {todayNotes.length > 0
              ? `已记录 ${todayNotes.length} 件事${streak > 1 ? ` · 连续 ${streak} 天` : ''}`
              : '从一句话开始，剩下的交给麻薯。'}
          </p>
          <button type="button" className="home-capture" onClick={() => onQuickCapture()}>
            <span className="home-capture-plus">
              <Icon name="plus" size={20} />
            </span>
            <span className="home-capture-text">记下现在发生的事…</span>
            <span className="home-capture-hint">一句话即可</span>
          </button>
          <div className="home-quick" role="group" aria-label="记录类型">
            {QUICK.map((item) => (
              <button
                key={item.kind}
                type="button"
                className="chip quick-chip"
                onClick={() => onQuickCapture(item.kind)}
              >
                <span
                  className="quick-dot"
                  style={{ background: `var(${KIND_INFO[item.kind].accentVar})` }}
                />
                {item.label}
              </button>
            ))}
            <button type="button" className="chip quick-chip quick-chip-agent" onClick={onOpenAgent}>
              问助手
            </button>
          </div>
        </section>

        {showInstallHint ? (
          <div className="install-hint" role="note">
            <Icon name="external" size={14} />
            <span className="install-hint-text">添加到主屏幕，断网也能记</span>
            <button type="button" className="install-hint-action" onClick={onOpenSettings}>
              查看
            </button>
            <button
              type="button"
              className="install-hint-dismiss"
              aria-label="不再提示"
              onClick={() => {
                dismissInstallHint();
                setShowInstallHint(false);
              }}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ) : null}

        {storageWarning ? (
          <div className="banner banner-warn" role="status">
            <Icon name="warn" size={15} />
            <span>{storageWarning}</span>
          </div>
        ) : null}

        <section className="today-metrics" aria-label="今日概览">
          {trends.slice(0, 4).map((trend) => (
            <div className="today-metric" key={trend.label}>
              <span className="today-metric-label">{trend.label}</span>
              <span className="today-metric-value mono">{trend.value}</span>
              {trend.detail ? <span className="today-metric-note">{trend.detail}</span> : null}
            </div>
          ))}
        </section>

        <section className="review-block" aria-label="昨日复盘">
          <div className="review-head">
            <h2 className="review-title">昨日复盘</h2>
            <span className="review-date mono">{brief.yesterdayKey.replaceAll('-', '.')}</span>
          </div>
          <p className="review-insight">
            {noData
              ? '还没有可对比的数据。今天记一笔，明天就会有自己的复盘。'
              : brief.summary}
          </p>
          {!noData ? (
          <div className="review-numbers">
            {trends.slice(0, 3).map((trend) => (
              <div className="review-number" key={trend.label}>
                <span className="review-number-value mono">{trend.value}</span>
                <span className="review-number-label">{trend.label.replace(' / 7日', '')}</span>
              </div>
            ))}
          </div>
          ) : null}
          <button
            type="button"
            className="review-link"
            aria-expanded={showFullReview}
            onClick={() => setShowFullReview((open) => !open)}
          >
            {showFullReview ? '收起复盘' : '查看完整复盘'}
            <Icon name={showFullReview ? 'chevronDown' : 'arrowRight'} size={14} />
          </button>
          {showFullReview ? (
            <ul className="review-full">
              {brief.review.map((line: string) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          {brief.suggestions.length > 0 ? (
            <>
              <div className="review-divider" />
              <h3 className="suggest-title">今天可以试试</h3>
              <ol className="suggest-list">
                {brief.suggestions.slice(0, noData ? 1 : 3).map((line: string, index: number) => (
                  <li key={line}>
                    <span className="suggest-index mono">{String(index + 1).padStart(2, '0')}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>

        <section className="trend-block" aria-label="近 7 天">
          <div className="block-head">
            <h2 className="review-title">近 7 天</h2>
          </div>
          <div className="trend-row">
            <span className="trend-label">支出</span>
            <Sparkline values={series.spend} color="var(--kind-finance)" width={92} height={20} />
            <span className="trend-value mono">{trends[0]?.value ?? '—'}</span>
          </div>
          <div className="trend-row">
            <span className="trend-label">睡眠</span>
            <Sparkline values={series.sleep} color="var(--kind-health)" width={92} height={20} />
            <span className="trend-value mono">{trends[2]?.value ?? '—'}</span>
          </div>
          <div className="trend-row">
            <span className="trend-label">记录</span>
            <Sparkline values={series.records} color="var(--kind-diary)" width={92} height={20} />
            <span className="trend-value mono">{trends[3]?.value ?? '—'}</span>
          </div>
        </section>

        <section className="today-timeline" aria-label="今日记录">
          <div className="block-head">
            <h2 className="review-title">今日记录</h2>
            <button type="button" className="link-btn" onClick={onOpenRecords}>
              全部 {todayNotes.length}
            </button>
          </div>
          {todayNotes.length === 0 ? (
            <p className="muted small">今天还没有记录。</p>
          ) : (
            <ul className="timeline">
              {todayNotes.slice(0, 8).map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`timeline-row kind-${note.kind}`}
                    style={{ ['--kind-accent' as string]: `var(${KIND_INFO[note.kind].accentVar})` }}
                    onClick={() => onOpenNote(note.id)}
                  >
                    <span className="timeline-time mono">{timeLabel(note)}</span>
                    <span className="timeline-mark" />
                    <span className="timeline-main">
                      <span className="timeline-title">{note.title || '未命名记录'}</span>
                      <span className="timeline-meta">
                        {KIND_INFO[note.kind].label}
                        {describeMeta(note) ? ` · ${describeMeta(note)}` : ''}
                      </span>
                    </span>
                    <span className="timeline-spend mono">
                      {note.meta.amount && note.kind !== 'health' ? formatMoney(note.meta.amount) : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
