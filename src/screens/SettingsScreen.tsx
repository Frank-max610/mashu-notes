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

const APP_VERSION = '0.9.0';

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
}: SettingsScreenProps) {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [customAvatar, setCustomAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  const [healthDetailsOpen, setHealthDetailsOpen] = useState(false);
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
          <MochiNode size={28} />
          <div className="brand-copy">
            <h1 className="page-title display">我的</h1>
            <p className="brand-date mono">麻薯 v{APP_VERSION}</p>
          </div>
        </div>
      </header>

      <div className="screen-body">
        <section>
          <div className="section-label">智能体 / AGENT</div>
          <div className="settings-card agent-persona">
            <div className="agent-persona-head">
              <AgentAvatar avatar={persona.avatar} name={persona.name} size={44} />
              <div className="agent-persona-copy">
                <div className="agent-persona-name">{persona.name}</div>
                <div className="agent-persona-hint">本地处理 · 仅你可见</div>
              </div>
            </div>

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
                  <AgentAvatar avatar={option.id} name={persona.name} size={30} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className="avatar-custom">
              <input
                className="field-input"
                value={customAvatar}
                maxLength={4}
                placeholder="或输入一个字符 / emoji"
                aria-label="自定义头像字符"
                onChange={(event) => setCustomAvatar(event.target.value)}
                onBlur={commitCustomAvatar}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">每日复盘 / BRIEF</div>
          <div className="settings-card">
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="sun" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">打开即生成</span>
                <span className="settings-row-hint">
                  「今日」页会根据昨天的记录生成复盘与 3 条改进建议，全部在本机计算，没有服务器。
                </span>
              </span>
            </div>
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="clock" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">固定时间提醒</span>
                <span className="settings-row-hint">
                  在「快捷指令 → 自动化 → 每天」里添加「打开麻薯」，就能按时看复盘；不需要推送服务器。
                </span>
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">Apple 健康 / HEALTH</div>
          <div className="settings-card">
            <SettingsRow
              icon="heart"
              label="导入健康数据"
              hint="Apple 健康导出的 JSON / CSV（步数、睡眠、心率、体重…）"
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
            <SettingsRow
              icon="link"
              label="复制快捷指令导入链接"
              hint="配合「快捷指令」每日自动同步（见下方说明）"
              onClick={() => void handleCopyShortcutUrl()}
            />
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="phone" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">Apple Watch / HealthKit</span>
                <span className="settings-row-hint">
                  Web 应用无法直接读取 HealthKit。当前提供「导出文件 / 快捷指令」两条零服务器路径；原生壳（Xcode + HealthKit）见仓库说明。
                </span>
              </span>
            </div>
          </div>

          <button
            type="button"
            className="health-guide-toggle mono"
            aria-expanded={healthDetailsOpen}
            onClick={() => setHealthDetailsOpen((open) => !open)}
          >
            {healthDetailsOpen ? '收起快捷指令说明' : '查看快捷指令说明'}
            <Icon name={healthDetailsOpen ? 'chevronDown' : 'arrowRight'} size={13} />
          </button>
          {healthDetailsOpen ? (
            <div className="health-guide">
              <p className="settings-note">
                推荐用文件方式（更稳定）：在「快捷指令」里读取健康样本 → 存到「文件」→ 回到这里点「导入健康数据」。
              </p>
              <p className="settings-note">
                也可以拼一条 URL 打开本应用自动导入：
                <code>{healthShortcutUrl}</code> 后接 URL 编码后的 JSON，例如
                <code>{'{"samples":[{"type":"steps","value":8321,"date":"2026-11-03T22:00:00+08:00"}]}'}</code>
                。注意：如果打开的是 Safari 而不是主屏幕应用，iOS 可能把数据写进另一份存储，所以文件导入更可靠。
              </p>
              <p className="settings-note">
                想直接读「健康」App：需要一个原生 iOS 壳（Swift + HealthKit），这是路线图里的可选形态；本仓库不含签名与 App Store 发布。
              </p>
            </div>
          ) : null}
        </section>

        <section>
          <div className="section-label">数据 / DATA</div>
          <div className="settings-card">
            <SettingsRow
              icon="download"
              label="导出全部记录（JSON）"
              hint={`${notes.length} 条 · 保留结构化字段`}
              onClick={() => void handleExportJson()}
            />
            <SettingsRow
              icon="book"
              label="导出 Markdown 合集"
              hint="单个 .md 文件，方便迁移"
              onClick={() => void handleExportMarkdown()}
            />
            <SettingsRow
              icon="upload"
              label="导入记录（合并）"
              hint="按标题合并，较新的优先"
              onClick={() => void handleImport('merge')}
            />
            <SettingsRow
              icon="database"
              label="导入记录（替换全部）"
              hint="用备份覆盖当前数据"
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
          {busy ? <p className="settings-note">正在处理文件…</p> : null}
        </section>

        <section>
          <div className="section-label">外观 / APPEARANCE</div>
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
          <div className="section-label">装到 iPhone / INSTALL</div>
          <IosInstallCard onCopyLink={() => void handleCopyLink()} />
          <p className="settings-note">
            装到主屏幕后断网也能用；换手机时先导出备份，再在新手机导入。所有内容只在这台设备上。
          </p>
        </section>

        <section>
          <div className="section-label">存储 / STORAGE</div>
          <div className="settings-card">
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="database" size={18} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">
                  本地存储 · {storageMode === 'indexeddb' ? '仅本机' : '仅本机（兼容模式）'}
                </span>
                <span className="settings-row-hint">已用 {usedText} · 数据不离开这台设备</span>
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">关于 / ABOUT</div>
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
                <span className="settings-row-hint">MIT 开源 · 本地优先 · 无服务器</span>
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
                <span className="settings-row-hint">开源项目</span>
              </span>
            </a>
          </div>
        </section>

        <p className="settings-footer mono">麻薯 · 本地生活记录</p>
      </div>
    </div>
  );
}
