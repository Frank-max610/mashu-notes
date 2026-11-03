import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentPersona, Note, ThemeMode } from '../lib/types';
import type { StorageMode } from '../lib/db';
import { storageEstimate } from '../lib/db';
import {
  fileStamp,
  mergeVaultNotes,
  parseVaultJson,
  pickTextFile,
  shareOrDownload,
  toMarkdownBundle,
  toVaultJson,
} from '../lib/exportImport';
import { formatBytes } from '../lib/format';
import { AGENT_AVATARS } from '../lib/prefs';
import { Icon, type IconName } from '../components/Icon';
import { AgentAvatar } from '../components/AgentAvatar';
import { MochiNode } from '../components/MochiNode';
import { IosInstallCard } from '../components/IosInstallCard';
import { DEFAULT_DIGEST_SCHEDULE, getDigestSchedule, setDigestSchedule } from '../lib/digest';

const APP_VERSION = '1.0.0';

export interface SettingsScreenProps {
  notes: Note[];
  storageMode: StorageMode;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onReplaceAll: (notes: Note[]) => Promise<void>;
  onClearAll: () => Promise<void>;
  notify: (message: string) => void;
  onOpenNote: (id: string) => void;
  persona: AgentPersona;
  onPersonaChange: (persona: AgentPersona) => void;
  onImportHealth: (text: string) => Promise<number>;
  /** Build + persist today's knowledge-base digest immediately. */
  onGenerateDigest: () => void;
}

interface RowProps {
  icon: IconName;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}

function SettingsRow({ icon, label, hint, onClick, danger }: RowProps) {
  return (
    <button type="button" className={`settings-row${danger ? ' is-danger' : ''}`} onClick={onClick}>
      <span className="settings-row-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint ? <span className="settings-row-hint">{hint}</span> : null}
      </span>
      <Icon name="arrowRight" size={15} />
    </button>
  );
}

const THEMES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

export function SettingsScreen({
  notes,
  storageMode,
  theme,
  onThemeChange,
  onReplaceAll,
  onClearAll,
  notify,
  onOpenNote,
  persona,
  onPersonaChange,
  onImportHealth,
  onGenerateDigest,
}: SettingsScreenProps) {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [customAvatar, setCustomAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  const [healthDetailsOpen, setHealthDetailsOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [digestSchedule, setDigestScheduleState] = useState(() => getDigestSchedule());
  const healthInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(persona.name);
  }, [persona]);

  const refreshUsage = useCallback(() => {
    void storageEstimate().then(setUsage);
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage, notes.length]);

  const welcomeNote = notes.find((note) => note.title.includes('欢迎'));

  const commitName = () => {
    const name = nameDraft.trim();
    if (name && name !== persona.name) onPersonaChange({ ...persona, name });
    else setNameDraft(persona.name);
  };

  const commitCustomAvatar = () => {
    const value = customAvatar.trim().slice(0, 4);
    if (!value) return;
    onPersonaChange({ ...persona, avatar: value });
    setCustomAvatar('');
  };

  const handleExportJson = async () => {
    if (notes.length === 0) {
      notify('还没有记录可以导出');
      return;
    }
    const result = await shareOrDownload(`mashu-${fileStamp()}.json`, toVaultJson(notes));
    notify(result === 'shared' ? '已打开分享面板，可存到「文件」或 iCloud 云盘' : '已导出 JSON');
  };

  const handleExportMarkdown = async () => {
    if (notes.length === 0) {
      notify('还没有记录可以导出');
      return;
    }
    const result = await shareOrDownload(`mashu-${fileStamp()}.md`, toMarkdownBundle(notes), 'text/markdown');
    notify(result === 'shared' ? '已打开分享面板' : '已导出 Markdown');
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    setBusy(true);
    try {
      const text = await pickTextFile();
      if (!text) return;
      const imported = parseVaultJson(text);
      if (mode === 'replace') {
        if (!window.confirm(`用文件中的 ${imported.length} 条记录替换当前全部 ${notes.length} 条？`)) return;
        await onReplaceAll(imported);
        notify(`已替换为 ${imported.length} 条记录`);
      } else {
        const { notes: merged, added, updated } = mergeVaultNotes(notes, imported);
        await onReplaceAll(merged);
        notify(`导入完成：新增 ${added} 条，更新 ${updated} 条`);
      }
      refreshUsage();
    } catch (error) {
      notify(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm(`确定删除全部 ${notes.length} 条记录吗？建议先导出备份。`)) return;
    if (!window.confirm('此操作不可撤销，再次确认？')) return;
    try {
      await onClearAll();
      notify('已清空');
    } catch {
      notify('清空失败，请重试');
    }
    refreshUsage();
  };

  const healthShortcutUrl = `${window.location.origin}${window.location.pathname}?health=`;
  const handleCopyShortcutUrl = async () => {
    try {
      await navigator.clipboard.writeText(healthShortcutUrl);
      notify('已复制导入链接前缀');
    } catch {
      notify(healthShortcutUrl);
    }
  };

  const handleHealthFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      await onImportHealth(text);
    } catch {
      notify('健康数据解析失败，请检查文件格式');
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('已复制应用链接');
    } catch {
      notify(window.location.href);
    }
  };

  const usedText = usage
    ? `${formatBytes(usage.usage)}${usage.quota ? ` / ${formatBytes(usage.quota)}` : ''}`
    : '统计中…';

  return (
    <div className="screen settings-screen">
      <header className="screen-header settings-header">
        <div className="brand-row">
          <MochiNode size={26} />
          <div className="brand-copy">
            <h1 className="page-title">设置</h1>
            <p className="brand-date">麻薯 v{APP_VERSION}</p>
          </div>
        </div>
      </header>

      <div className="screen-body settings-body">
        <section>
          <div className="section-label">助手</div>
          <div className="settings-card">
            <button type="button" className="settings-row" onClick={() => setPersonaOpen((open) => !open)} aria-expanded={personaOpen}>
              <AgentAvatar avatar={persona.avatar} name={persona.name} size={34} />
              <span className="settings-row-text">
                <span className="settings-row-label">{persona.name}</span>
                <span className="settings-row-hint">本地处理 · 仅你可见</span>
              </span>
              <Icon name={personaOpen ? 'chevronDown' : 'arrowRight'} size={15} />
            </button>
            {personaOpen ? (
              <div className="persona-editor">
                <label className="field-field">
                  <span className="field-label">名字</span>
                  <input
                    className="field-input"
                    value={nameDraft}
                    maxLength={12}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </label>
                <div className="field-label">头像</div>
                <div className="avatar-grid">
                  {AGENT_AVATARS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`avatar-option${persona.avatar === option.id ? ' is-active' : ''}`}
                      onClick={() => onPersonaChange({ ...persona, avatar: option.id })}
                    >
                      <AgentAvatar avatar={option.id} name={persona.name} size={28} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
                <input
                  className="field-input persona-custom"
                  value={customAvatar}
                  maxLength={4}
                  placeholder="或输入一个字符"
                  aria-label="自定义头像字符"
                  onChange={(event) => setCustomAvatar(event.target.value)}
                  onBlur={commitCustomAvatar}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <div className="section-label">外观</div>
          <div className="segmented" role="group" aria-label="主题">
            {THEMES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`segmented-item${theme === item.value ? ' is-active' : ''}`}
                aria-pressed={theme === item.value}
                onClick={() => onThemeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">数据与隐私</div>
          <div className="settings-card">
            <SettingsRow
              icon="download"
              label="导出完整备份"
              hint="可存到「文件」或 iCloud 云盘"
              onClick={() => void handleExportJson()}
            />
            <SettingsRow
              icon="upload"
              label="从备份恢复"
              hint="合并记录，保留较新的版本"
              onClick={() => void handleImport('merge')}
            />
            <SettingsRow
              icon="upload"
              label="用备份替换全部记录"
              hint="会覆盖当前数据"
              onClick={() => void handleImport('replace')}
            />
            <SettingsRow
              icon="trash"
              label="清空全部记录"
              hint="不可撤销，建议先导出备份"
              onClick={() => void handleClear()}
              danger
            />
          </div>
          <p className="settings-note">记录只保存在这台设备上；清除浏览器数据或删除应用会移除本地记录。</p>
          {busy ? <p className="settings-note">正在处理文件…</p> : null}
        </section>

        <section>
          <div className="section-label">Apple 健康</div>
          <div className="settings-card">
            <SettingsRow
              icon="heart"
              label="连接 Apple 健康"
              hint="通过快捷指令导入步数、睡眠、心率、体重"
              onClick={() => healthInputRef.current?.click()}
            />
            <input
              ref={healthInputRef}
              type="file"
              accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              hidden
              onChange={(event) => {
                void handleHealthFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
          <button
            type="button"
            className="health-guide-toggle"
            aria-expanded={healthDetailsOpen}
            onClick={() => setHealthDetailsOpen((open) => !open)}
          >
            {healthDetailsOpen ? '收起导入说明' : '如何导入？'}
            <Icon name={healthDetailsOpen ? 'chevronDown' : 'arrowRight'} size={13} />
          </button>
          {healthDetailsOpen ? (
            <p className="settings-note">
              Web 版无法直接读取健康数据。推荐在「快捷指令」里读取健康样本并存成文件，再回到这里导入；详细格式与自动化说明在「高级」。
            </p>
          ) : null}
        </section>

        <section>
          <div className="section-label">自动化</div>
          <div className="settings-card">
            <label className="settings-row module-toggle">
              <span className="settings-row-icon">
                <Icon name="sun" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">每日汇总</span>
                <span className="settings-row-hint">按目录汇总昨天，并给出今天的建议</span>
              </span>
              <input
                type="checkbox"
                checked={digestSchedule.enabled}
                onChange={(event) => {
                  const next = setDigestSchedule({ enabled: event.target.checked });
                  setDigestScheduleState(next);
                }}
                aria-label="启用每日汇总"
              />
            </label>
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="clock" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">汇总时间</span>
                <span className="settings-row-hint">到达时间后，下一次打开应用自动生成</span>
              </span>
              <input
                className="digest-time"
                type="time"
                value={digestSchedule.time || DEFAULT_DIGEST_SCHEDULE.time}
                onChange={(event) => {
                  const next = setDigestSchedule({ time: event.target.value });
                  setDigestScheduleState(next);
                }}
                aria-label="每日汇总时间"
              />
            </div>
            <button type="button" className="settings-row" onClick={onGenerateDigest}>
              <span className="settings-row-icon"><Icon name="sparkles" size={18} /></span>
              <span className="settings-row-text">
                <span className="settings-row-label">立即生成今日汇总</span>
                <span className="settings-row-hint">汇总会出现在助手的对话里</span>
              </span>
              <Icon name="arrowRight" size={15} />
            </button>
            <div className="settings-row as-static">
              <span className="settings-row-icon"><Icon name="phone" size={18} /></span>
              <span className="settings-row-text">
                <span className="settings-row-label">固定时间提醒</span>
                <span className="settings-row-hint">在「快捷指令 → 自动化」里每天打开麻薯，就能准时看到汇总</span>
              </span>
            </div>
          </div>
        </section>

        <section>
          <details className="settings-advanced">
            <summary className="settings-advanced-summary">
              <span>高级设置</span>
              <span className="settings-advanced-hint">导出格式、健康导入、存储与迁移</span>
            </summary>
            <div className="settings-card">
              <SettingsRow
                icon="book"
                label="导出为文本（Markdown）"
                hint="方便迁移到其他笔记工具"
                onClick={() => void handleExportMarkdown()}
              />
              <SettingsRow
                icon="link"
                label="复制快捷指令导入链接"
                hint="用于「健康」自动化导入"
                onClick={() => void handleCopyShortcutUrl()}
              />
              <div className="settings-row as-static">
                <span className="settings-row-icon">
                  <Icon name="database" size={18} />
                </span>
                <span className="settings-row-text">
                  <span className="settings-row-label">本地存储</span>
                  <span className="settings-row-hint">
                    {storageMode === 'indexeddb' ? 'IndexedDB' : 'localStorage'} · 已用 {usedText}
                  </span>
                </span>
              </div>
              <div className="settings-row as-static">
                <span className="settings-row-icon">
                  <Icon name="info" size={18} />
                </span>
                <span className="settings-row-text">
                  <span className="settings-row-label">数据迁移</span>
                  <span className="settings-row-hint">旧版本记录会在首次打开时自动迁移到新存储</span>
                </span>
              </div>
              <div className="settings-note settings-note-inner">
                健康导入支持 Apple 健康的 JSON / CSV 文件，或 URL 参数
                <code>{healthShortcutUrl}</code>
                （后接 URL 编码的 JSON）。示例：
                <code>{'{"samples":[{"type":"steps","value":8321,"date":"2026-11-03T22:00:00+08:00"}]}'}</code>
                。原生 HealthKit 壳是路线图可选项，当前版本不包含。
              </div>
            </div>
          </details>
        </section>

        <section>
          <div className="section-label">关于</div>
          <div className="settings-card">
            {welcomeNote ? (
              <SettingsRow
                icon="book"
                label="打开示例记录"
                hint="看看麻薯能记些什么"
                onClick={() => onOpenNote(welcomeNote.id)}
              />
            ) : null}
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="info" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">麻薯 v{APP_VERSION}</span>
                <span className="settings-row-hint">本地生活操作系统 · 开源</span>
              </span>
            </div>
            <a
              className="settings-row as-static"
              href="https://github.com/Frank-max610/mashu-notes"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="settings-row-icon">
                <Icon name="external" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">项目主页</span>
                <span className="settings-row-hint">开源许可与更新说明</span>
              </span>
            </a>
          </div>
          <div className="settings-install">
            <IosInstallCard onCopyLink={() => void handleCopyLink()} />
          </div>
        </section>

        <p className="settings-footer">记录 · 连接 · 理解</p>
      </div>
    </div>
  );
}
