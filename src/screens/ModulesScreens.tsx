import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { HEALTH_METRICS } from '../lib/kinds';
import { dayKeyOf, noteDayKey, formatMoney } from '../lib/insights';
import { formatRelativeTime } from '../lib/format';
import { Icon } from '../components/Icon';
import { Sparkline } from '../components/Sparkline';

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="screen-header">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="brand-date">{sub}</p>
      </div>
    </header>
  );
}

export function ProfileScreen({ notes }: { notes: Note[] }) {
  const stats = useMemo(() => {
    const activeDays = new Set(notes.map(noteDayKey));
    const tags = new Map<string, number>();
    for (const note of notes) for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const health = (metric: string) =>
      notes
        .filter((note) => note.kind === 'health' && note.meta.metric === metric && note.meta.value !== undefined)
        .sort((a, b) => (b.meta.occurredAt ?? b.createdAt) - (a.meta.occurredAt ?? a.createdAt));
    const sleep = health('睡眠');
    const weight = health('体重');
    const spend = notes
      .filter((note) => note.kind === 'finance' && note.meta.direction !== 'income')
      .reduce((sum, note) => sum + (note.meta.amount ?? 0), 0);
    const streak = (() => {
      const days = new Set(notes.map(noteDayKey));
      const cursor = new Date();
      if (!days.has(dayKeyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
      let n = 0;
      while (days.has(dayKeyOf(cursor))) { n += 1; cursor.setDate(cursor.getDate() - 1); }
      return n;
    })();
    return { activeDays: activeDays.size, topTags, sleep: sleep[0]?.meta.value, weight: weight[0]?.meta.value, spend, streak, diaries: notes.filter((n) => n.kind === 'diary').length };
  }, [notes]);

  return (
    <div className="screen module-screen">
      <Header title="个人画像" sub="从记录里看见自己" />
      <div className="screen-body">
        <section className="profile-hero">
          <p className="profile-line">你已经记录了 <strong>{stats.activeDays}</strong> 天，连续记录 <strong>{stats.streak}</strong> 天。</p>
          <p className="settings-note">画像由本机记录自动计算，不需要上传任何数据。</p>
        </section>
        <div className="profile-grid">
          <div className="profile-stat"><span>最近体重</span><strong>{stats.weight ? `${stats.weight} kg` : '—'}</strong></div>
          <div className="profile-stat"><span>最近睡眠</span><strong>{stats.sleep ? `${stats.sleep} 小时` : '—'}</strong></div>
          <div className="profile-stat"><span>累计支出</span><strong>{stats.spend ? formatMoney(stats.spend) : '—'}</strong></div>
          <div className="profile-stat"><span>日记</span><strong>{stats.diaries} 篇</strong></div>
        </div>
        <section>
          <div className="section-label">常出现的标签</div>
          {stats.topTags.length === 0 ? <p className="muted small">记录多了以后，这里会长出你的关键词。</p> : (
            <div className="profile-tags">
              {stats.topTags.map(([tag, count]) => <span key={tag} className="chip">#{tag} <span className="chip-count">{count}</span></span>)}
            </div>
          )}
        </section>
        <p className="settings-note">更多画像维度（年度总结、情绪曲线）会在后续版本加入。</p>
      </div>
    </div>
  );
}

export function HealthScreen({ notes, onOpenNote }: { notes: Note[]; onOpenNote: (id: string) => void }) {
  const health = notes.filter((note) => note.kind === 'health' && !note.archivedAt);
  const latest = (metric: string) => health.filter((n) => n.meta.metric === metric).sort((a, b) => (b.meta.occurredAt ?? b.createdAt) - (a.meta.occurredAt ?? a.createdAt))[0];
  const metrics = ['睡眠', '步数', '体重', '心率', '饮水', '活动能量'].filter((m) => (HEALTH_METRICS as readonly string[]).includes(m));
  const series = (metric: string) => health.filter((n) => n.meta.metric === metric && n.meta.value !== undefined).slice(0, 14).reverse().map((n) => n.meta.value ?? 0);
  return (
    <div className="screen module-screen">
      <Header title="健康数据" sub="睡眠、步数与身体趋势" />
      <div className="screen-body">
        <div className="profile-grid">
          {metrics.map((metric) => {
            const note = latest(metric);
            const values = series(metric);
            return (
              <div className="profile-stat health-stat" key={metric}>
                <span>{metric}</span>
                <strong>{note ? `${note.meta.value} ${note.meta.unit ?? ''}` : '—'}</strong>
                {values.length > 1 ? <Sparkline values={values} color="var(--kind-health)" width={80} height={18} /> : null}
              </div>
            );
          })}
        </div>
        <section>
          <div className="section-label">最近的健康记录</div>
          <div className="record-list">
            {health.slice(0, 12).map((note) => (
              <button key={note.id} type="button" className="module-row" onClick={() => onOpenNote(note.id)}>
                <span className="record-dot" style={{ background: 'var(--kind-health)' }} />
                <span className="record-main"><span className="record-title">{note.title}</span><span className="record-meta">{formatRelativeTime(note.updatedAt)}</span></span>
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
          {health.length === 0 ? <p className="muted small">在“设置 → Apple 健康”导入，或直接记录一条健康数据。</p> : null}
        </section>
      </div>
    </div>
  );
}

export function FinanceScreen({ notes, onOpenNote }: { notes: Note[]; onOpenNote: (id: string) => void }) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const finances = notes.filter((note) => note.kind === 'finance' && new Date(note.meta.occurredAt ?? note.createdAt).getMonth() === month && new Date(note.meta.occurredAt ?? note.createdAt).getFullYear() === year);
  const expense = finances.filter((n) => n.meta.direction !== 'income').reduce((s, n) => s + (n.meta.amount ?? 0), 0);
  const income = finances.filter((n) => n.meta.direction === 'income').reduce((s, n) => s + (n.meta.amount ?? 0), 0);
  const byCategory = new Map<string, number>();
  for (const note of finances) if (note.meta.direction !== 'income') byCategory.set(note.meta.category ?? '其他', (byCategory.get(note.meta.category ?? '其他') ?? 0) + (note.meta.amount ?? 0));
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div className="screen module-screen">
      <Header title="理财" sub="这个月的收支" />
      <div className="screen-body">
        <div className="profile-grid">
          <div className="profile-stat"><span>本月支出</span><strong>{formatMoney(expense)}</strong></div>
          <div className="profile-stat"><span>本月收入</span><strong>{formatMoney(income)}</strong></div>
        </div>
        <section>
          <div className="section-label">分类</div>
          {top.length === 0 ? <p className="muted small">这个月还没有收支记录。</p> : (
            <div className="finance-bars">
              {top.map(([category, amount]) => (
                <div key={category} className="finance-bar-row">
                  <span>{category}</span>
                  <div className="finance-bar"><i style={{ width: `${Math.max(8, Math.round((amount / expense) * 100))}%` }} /></div>
                  <span className="mono">{formatMoney(amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="section-label">最近</div>
          <div className="record-list">
            {finances.slice(0, 10).map((note) => (
              <button key={note.id} type="button" className="module-row" onClick={() => onOpenNote(note.id)}>
                <span className="record-dot" style={{ background: 'var(--kind-finance)' }} />
                <span className="record-main"><span className="record-title">{note.title}</span><span className="record-meta">{formatRelativeTime(note.updatedAt)}</span></span>
                <span className="mono">{formatMoney(note.meta.amount ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function TemplatesScreen({ notes, onUse, onOpen }: { notes: Note[]; onUse: (note: Note) => void; onOpen: (id: string) => void }) {
  const templates = notes.filter((note) => note.tags.includes('模板'));
  return (
    <div className="screen module-screen">
      <Header title="模板" sub="可复用的记录骨架" />
      <div className="screen-body">
        {templates.length === 0 ? <div className="empty"><p className="empty-title">还没有模板</p><p className="empty-text">把一条常用格式的记录加上 #模板 就能复用。</p></div> : (
          <div className="record-list">
            {templates.map((note) => (
              <div key={note.id} className="template-row">
                <button type="button" className="record-main template-main" onClick={() => onOpen(note.id)}>
                  <span className="record-title">{note.title}</span>
                  <span className="record-meta">{note.content.split('\n')[0].replaceAll('#模板', '').trim() || '模板'}</span>
                </button>
                <button type="button" className="btn btn-small" onClick={() => onUse(note)}>使用</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ArchiveScreen({ notes, onOpen, onRestore, onDelete }: { notes: Note[]; onOpen: (id: string) => void; onRestore: (note: Note) => void; onDelete: (note: Note) => void }) {
  const archived = notes.filter((note) => note.archivedAt);
  return (
    <div className="screen module-screen">
      <Header title="归档" sub="收起的记录" />
      <div className="screen-body">
        {archived.length === 0 ? <div className="empty"><Icon name="database" size={24} /><p className="empty-title">还没有归档</p><p className="empty-text">在记录的更多菜单里可以归档。</p></div> : (
          <div className="record-list">
            {archived.map((note) => (
              <div key={note.id} className="record-row">
                <span className="record-dot" style={{ background: 'var(--text-muted)' }} />
                <button type="button" className="record-main archive-main" onClick={() => onOpen(note.id)}>
                  <span className="record-title">{note.title}</span>
                  <span className="record-meta">{formatRelativeTime(note.updatedAt)}</span>
                </button>
                <button type="button" className="chip" onClick={() => onRestore(note)}>恢复</button>
                <button type="button" className="record-more" aria-label={`删除归档：${note.title}`} onClick={() => onDelete(note)}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AttachmentsScreen() {
  return (
    <div className="screen module-screen">
      <Header title="附件" sub="图片与文件" />
      <div className="screen-body">
        <div className="empty">
          <Icon name="link" size={24} />
          <p className="empty-title">附件模块还在准备中</p>
          <p className="empty-text">当前版本可以用 Markdown 图片链接记录图片；本地附件的安全存放会在后续版本加入。</p>
        </div>
      </div>
    </div>
  );
}
