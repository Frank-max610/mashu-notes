import { useMemo, useState } from 'react';
import type { Note, NoteKind } from '../lib/types';
import { KIND_INFO, describeMeta } from '../lib/kinds';
import { dayKeyOf, noteDayKey, type DaySummary } from '../lib/insights';
import type { DailyBrief } from '../lib/brief';
import { formatMoney } from '../lib/insights';
import { BrandSeal } from '../components/BrandSeal';
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
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
}

function timeLabel(note: Note): string {
  const ts = note.meta.occurredAt ?? note.createdAt;
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

  const series = useMemo(() => {
    const last = range.slice(-7);
    return {
      spend: last.map((day) => day.spend),
      calories: last.map((day) => day.calories),
      sleep: last.map((day) => day.sleep ?? 0),
      records: last.map((day) => day.recordCount),
      days: last,
    };
  }, [range]);

  const metricCards = [
    { label: '支出 / 7日', value: brief.trends[0]?.value ?? '—', detail: brief.trends[0]?.detail, values: series.spend, color: 'var(--kind-finance)' },
    { label: '摄入 / 7日', value: brief.trends[1]?.value ?? '—', detail: brief.trends[1]?.detail, values: series.calories, color: 'var(--kind-food)' },
    { label: '睡眠 / 7日', value: brief.trends[2]?.value ?? '—', detail: brief.trends[2]?.detail, values: series.sleep, color: 'var(--kind-health)' },
    { label: '记录 / 7日', value: brief.trends[3]?.value ?? '—', detail: brief.trends[3]?.detail, values: series.records, color: 'var(--kind-diary)' },
  ];

  return (
    <div className="screen today-screen">
      <header className="screen-header today-header">
        <div className="brand-row">
          <BrandSeal size={30} />
          <div className="brand-copy">
            <h1 className="brand-wordmark display">日新</h1>
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

      {showInstallHint ? (
        <div className="install-hint" role="note">
          <Icon name="external" size={14} />
          <span className="install-hint-text">添加到主屏幕后，断网也能记录</span>
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

      <div className="screen-body today-body">
        <section className="brief-block" aria-label="昨日复盘与今日建议">
          <div className="block-head">
            <span className="section-label">昨日复盘 / REVIEW</span>
            <span className="block-date mono">{brief.yesterdayKey.replaceAll('-', '.')}</span>
          </div>
          <p className="brief-summary display">{brief.summary}</p>
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
        </section>

        <section className="metric-grid" aria-label="近七日指标">
          {metricCards.map((card) => (
            <div className="metric-card" key={card.label}>
              <span className="metric-label mono">{card.label}</span>
              <span className="metric-value display">{card.value}</span>
              {card.detail ? <span className="metric-detail mono">{card.detail}</span> : null}
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
              style={{
                ['--kind-accent' as string]: `var(${KIND_INFO[item.kind].accentVar})`,
              }}
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
            <button type="button" className="link-btn mono" onClick={onOpenRecords}>
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
                      <span className="timeline-meta mono">
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
