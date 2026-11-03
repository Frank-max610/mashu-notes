import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentPersona, Note, ThemeMode } from '../lib/types';
import type { StorageMode } from '../lib/db';
import { storageEstimate } from '../lib/db';
import {
  fileStamp,
  parseVaultJson,
  pickTextFile,
  toMarkdownBundle,
  toVaultJson,
  mergeVaultNotes,
  shareOrDownload,
} from '../lib/exportImport';
import { formatBytes } from '../lib/format';
import { AGENT_AVATARS } from '../lib/prefs';
import { Icon, type IconName } from '../components/Icon';
import { AgentAvatar } from '../components/AgentAvatar';
import { IosInstallCard } from '../components/IosInstallCard';

const APP_VERSION = '0.3.0';

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
        <Icon name={icon} size={19} />
      </span>
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint ? <span className="settings-row-hint">{hint}</span> : null}
      </span>
      <Icon name="arrowRight" size={16} />
    </button>
  );
}

const THEMES: ReadonlyArray<{ value: ThemeMode; label: string; icon: IconName }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'info' },
];

function isPresetAvatar(avatar: string): boolean {
  return AGENT_AVATARS.some((option) => option.id === avatar);
}

/** Settings: agent persona, data, storage, appearance and about. */
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
}: SettingsScreenProps) {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [emojiDraft, setEmojiDraft] = useState(isPresetAvatar(persona.avatar) ? '' : persona.avatar);

  useEffect(() => {
    setNameDraft(persona.name);
    setEmojiDraft(isPresetAvatar(persona.avatar) ? '' : persona.avatar);
  }, [persona]);

  const refreshUsage = useCallback(() => {
    void storageEstimate().then(setUsage);
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage, notes.length]);

  const welcomeNote = useMemo(() => notes.find((note) => note.title.includes('欢迎')), [notes]);

  const commitName = () => {
    const name = nameDraft.trim();
    if (name && name !== persona.name) onPersonaChange({ ...persona, name });
    else setNameDraft(persona.name);
  };

  const commitEmoji = () => {
    const emoji = emojiDraft.trim().slice(0, 4);
    if (!emoji) return;
    onPersonaChange({ ...persona, avatar: emoji });
    setEmojiDraft('');
  };

  const handleExportJson = async () => {
    if (notes.length === 0) {
      notify('还没有记录可以导出');
      return;
    }
    const result = await shareOrDownload(`mashu-${fileStamp()}.json`, toVaultJson(notes));
    notify(
      result === 'shared'
        ? '已打开分享面板，可存到「文件」或 iCloud 云盘'
        : `已导出 ${notes.length} 条记录`,
    );
  };

  const handleExportMarkdown = async () => {
    if (notes.length === 0) {
      notify('还没有记录可以导出');
      return;
    }
    const result = await shareOrDownload(
      `mashu-${fileStamp()}.md`,
      toMarkdownBundle(notes),
      'text/markdown',
    );
    notify(result === 'shared' ? '已打开分享面板' : '已导出 Markdown');
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    setBusy(true);
    try {
      const text = await pickTextFile();
      if (!text) return;
      const imported = parseVaultJson(text);
      if (mode === 'replace') {
        const confirmed = window.confirm(
          `将用文件中的 ${imported.length} 条记录替换当前全部 ${notes.length} 条，此操作不可撤销。继续？`,
        );
        if (!confirmed) return;
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
    const first = window.confirm(`确定要删除全部 ${notes.length} 条记录吗？建议先导出备份。`);
    if (!first) return;
    const second = window.confirm('此操作不可撤销。再次确认删除全部记录？');
    if (!second) return;
    try {
      await onClearAll();
      notify('已清空');
    } catch {
      notify('清空失败，请重试');
    }
    refreshUsage();
  };

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      notify('已复制当前地址');
    } catch {
      notify(url);
    }
  };

  const usedText = usage
    ? `${formatBytes(usage.usage)}${usage.quota ? ` / ${formatBytes(usage.quota)}` : ''}`
    : '统计中…';

  return (
    <div className="screen settings-screen">
      <header className="screen-header settings-header">
        <div>
          <h1 className="screen-title">我的</h1>
          <p className="screen-subtitle">助手、数据与外观</p>
        </div>
      </header>

      <div className="screen-body">
        <section>
          <div className="section-label">智能体</div>
          <div className="settings-card agent-persona">
            <div className="agent-persona-head">
              <AgentAvatar avatar={persona.avatar} size={46} />
              <div className="agent-persona-copy">
                <div className="agent-persona-name">{persona.name}</div>
                <div className="agent-persona-hint">本地助手 · 头像和名字都可以换</div>
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
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
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
                  aria-label={`使用 ${option.label} 头像`}
                  onClick={() => onPersonaChange({ ...persona, avatar: option.id })}
                >
                  <AgentAvatar avatar={option.id} size={34} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className="avatar-custom">
              <input
                className="field-input"
                value={emojiDraft}
                maxLength={4}
                placeholder="或输入一个 emoji，如 🌱"
                aria-label="自定义 emoji 头像"
                onChange={(event) => setEmojiDraft(event.target.value)}
                onBlur={commitEmoji}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">数据</div>
          <div className="settings-card">
            <SettingsRow
              icon="download"
              label="导出全部记录（JSON）"
              hint={`${notes.length} 条 · 完整保留结构化字段`}
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
              hint="按标题合并，较新的版本优先"
              onClick={() => void handleImport('merge')}
            />
            <SettingsRow
              icon="database"
              label="导入记录（替换全部）"
              hint="用备份完全覆盖当前数据"
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
          <div className="section-label">存储</div>
          <div className="settings-card">
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="database" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">
                  本地存储 · {storageMode === 'indexeddb' ? 'IndexedDB' : 'localStorage（降级）'}
                </span>
                <span className="settings-row-hint">已用 {usedText} · 数据不离开这台设备</span>
              </span>
            </div>
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
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">装到 iPhone 上</div>
          <IosInstallCard onCopyLink={() => void handleCopyLink()} />
          <p className="settings-note">
            没有服务器：整个应用就是一组静态文件，装到主屏幕后断网也能用。换手机时，用上面的「导出全部记录」存到「文件」或 iCloud 云盘，再在新手机里导入。
          </p>
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
                <Icon name="info" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">麻薯 · v{APP_VERSION}</span>
                <span className="settings-row-hint">MIT 协议开源 · 本地优先的生活记录</span>
              </span>
            </div>
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="warn" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">备份提醒</span>
                <span className="settings-row-hint">清理浏览器数据会删除记录，重要内容请定期导出。</span>
              </span>
            </div>
            <a
              className="settings-row as-static"
              href="https://github.com/Frank-max610/mashu-notes"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="settings-row-icon">
                <Icon name="external" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">项目主页</span>
                <span className="settings-row-hint">GitHub · MIT 开源</span>
              </span>
            </a>
          </div>
        </section>

        <p className="settings-footer">本地优先 · 数据属于你</p>
      </div>
    </div>
  );
}
