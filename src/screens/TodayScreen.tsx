import { useMemo, useState } from 'react';
import type { Note, NoteKind } from '../lib/types';
import { KIND_INFO, describeMeta } from '../lib/kinds';
import { dayKeyOf, noteDayKey, formatMoney, type DaySummary } from '../lib/insights';
import type { DailyBrief } from '../lib/brief';
import { Mascot, MashuMark } from '../components/Mascot';
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
  { kind: 'food', label: '记饮食' },
  { kind: 'health', label: '记健康' },
  { kind: 'finance', label: '记一笔' },
  { kind: 'diary', label: '写日记' },
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

/** Consecutive days with at least one record, ending today (or yesterday). */
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

/** Dashboard first screen: yesterday review, today's suggestions, today's log. */
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
      calories: last.map((day) => day.calories),
      sleep: last.map((day) => day.sleep ?? 0),
      records: last.map((day) => day.recordCount),
    };
  }, [range]);

  const metricCards = [
    {
      kind: 'finance',
      label: '支出 / 7日',
      value: brief.trends[0]?.value ?? '—',
      detail: brief.trends[0]?.detail,
      values: series.spend,
      color: 'var(--kind-finance)',
    },
    {
      kind: 'food',
      label: '摄入 / 7日',
      value: brief.trends[1]?.value ?? '—',
      detail: brief.trends[1]?.detail,
      values: series.calories,
      color: 'var(--kind-food)',
    },
    {
      kind: 'health',
      label: '睡眠 / 7日',
      value: brief.trends[2]?.value ?? '—',
      detail: brief.trends[2]?.detail,
      values: series.sleep,
      color: 'var(--kind-health)',
    },
    {
      kind: 'diary',
      label: '记录 / 7日',
      value: brief.trends[3]?.value ?? '—',
      detail: brief.trends[3]?.detail,
      values: series.records,
      color: 'var(--kind-diary)',
    },
  ];

  return (
    <div className="screen today-screen">
      <header className="screen-header today-header">
        <div className="brand-row">
          <MashuMark size={38} />
          <div className="brand-copy">
            <h1 className="brand-wordmark display">麻薯</h1>
            <p className="brand-date mono">{dateLabel()}</p>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="搜索" onClick={onOpenSearch}>
            <Icon name="search" size={19} />
          </button>
          <button type="button" className="icon-btn" aria-label="设置" onClick={onOpenSettings}>
            <Icon name="settings" size={19} />
          </button>
        </div>
      </header>

      <div className="screen-body today-body">
        <section className="today-hero rise-in" aria-label="今日概览">
          <div className="hero-top">
            <div>
              <h2 className="hero-greeting">
                {greeting()}，<span className="gradient-text">今天记点什么？</span>
              </h2>
              <p className="hero-sub">
                {todayNotes.length > 0
                  ? `今天已记 ${todayNotes.length} 笔${streak > 1 ? ` · 连续 ${streak} 天` : ''}，继续保持。`
                  : '用一句话开始，剩下的交给麻薯。'}
              </p>
            </div>
            <Mascot size={74} bob className="hero-mascot" />
          </div>

          <button type="button" className="ask-bar" onClick={onOpenAgent}>
            <span className="ask-bar-icon">
              <Icon name="sparkles" size={17} />
            </span>
            <span className="ask-bar-text">问问小助手：今天花了多少？这周睡得怎么样？</span>
            <span className="ask-bar-go">
              <Icon name="arrowRight" size={16} />
            </span>
          </button>
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

        <section className="brief-block" aria-label="昨日复盘与今日建议">
          <div className="brief-inner">
            <div className="block-head">
              <span className="section-label">昨日复盘 / REVIEW</span>
              <span className="block-date mono">{brief.yesterdayKey.replaceAll('-', '.')}</span>
            </div>
            <p className="brief-summary">{brief.summary}</p>
            {brief.review.length > 0 ? (
              <ul className="brief-list">
                {brief.review.map((line: string) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}

            <div className="brief-divider" />

            <div className="block-head">
              <span className="section-label">今日改进 / ADJUST</span>
            </div>
            {brief.suggestions.length > 0 ? (
              <ol className="suggest-list">
                {brief.suggestions.map((line: string, index: number) => (
                  <li key={line}>
                    <span className="suggest-index mono">{String(index + 1).padStart(2, '0')}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">暂无建议，今天记几笔之后就会有了。</p>
            )}
          </div>
        </section>

        <section className="metric-grid" aria-label="近七日指标">
          {metricCards.map((card) => (
            <div className={`metric-card kind-${card.kind}`} key={card.label}>
              <span className="metric-label">{card.label}</span>
              <span className="metric-value">{card.value}</span>
              {card.detail ? <span className="metric-detail">{card.detail}</span> : null}
              <Sparkline values={card.values} color={card.color} width={78} height={18} />
            </div>
          ))}
        </section>

        <div className="quick-row" role="group" aria-label="快捷记录">
          {QUICK.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`quick-btn kind-${item.kind}`}
              style={{ ['--kind-accent' as string]: `var(${KIND_INFO[item.kind].accentVar})` }}
              onClick={() => onQuickCapture(item.kind)}
            >
              <span className="quick-mark" />
              {item.label}
            </button>
          ))}
          <button type="button" className="quick-btn quick-agent" onClick={onOpenAgent}>
            <Icon name="sparkles" size={14} />
            问助手
          </button>
        </div>

        <section aria-label="今日记录">
          <div className="block-head">
            <span className="section-label">今日记录 / TODAY</span>
            <button type="button" className="link-btn" onClick={onOpenRecords}>
              全部 {todayNotes.length}
            </button>
          </div>
          {todayNotes.length === 0 ? (
            <p className="muted small">今天还没有记录，点上面的快捷按钮开始。</p>
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
