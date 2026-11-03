import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Note, ThemeMode } from '../lib/types';
import type { StorageMode } from '../lib/db';
import { storageEstimate } from '../lib/db';
import {
  downloadText,
  fileStamp,
  mergeVaultNotes,
  parseVaultJson,
  pickTextFile,
  toMarkdownBundle,
  toVaultJson,
} from '../lib/exportImport';
import { formatBytes } from '../lib/format';
import { Icon, type IconName } from '../components/Icon';

const APP_VERSION = '0.1.0';

export interface SettingsScreenProps {
  notes: Note[];
  storageMode: StorageMode;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onReplaceAll: (notes: Note[]) => Promise<void>;
  onClearAll: () => Promise<void>;
  notify: (message: string) => void;
  onOpenNote: (id: string) => void;
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
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'system', label: '跟随系统', icon: 'info' },
];

/** Settings: data portability, storage, appearance and about. */
export function SettingsScreen({
  notes,
  storageMode,
  theme,
  onThemeChange,
  onReplaceAll,
  onClearAll,
  notify,
  onOpenNote,
}: SettingsScreenProps) {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshUsage = useCallback(() => {
    void storageEstimate().then(setUsage);
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage, notes.length]);

  const welcomeNote = useMemo(
    () => notes.find((note) => note.title.includes('欢迎')),
    [notes],
  );

  const handleExportJson = () => {
    if (notes.length === 0) {
      notify('还没有笔记可以导出');
      return;
    }
    downloadText(`inkstone-${fileStamp()}.json`, toVaultJson(notes));
    notify(`已导出 ${notes.length} 条笔记（JSON）`);
  };

  const handleExportMarkdown = () => {
    if (notes.length === 0) {
      notify('还没有笔记可以导出');
      return;
    }
    downloadText(`inkstone-${fileStamp()}.md`, toMarkdownBundle(notes), 'text/markdown');
    notify('已导出 Markdown 合集');
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    setBusy(true);
    try {
      const text = await pickTextFile();
      if (!text) return;
      const imported = parseVaultJson(text);
      if (mode === 'replace') {
        const confirmed = window.confirm(
          `将用文件中的 ${imported.length} 条笔记替换当前全部 ${notes.length} 条笔记，此操作不可撤销。确定继续？`,
        );
        if (!confirmed) return;
        await onReplaceAll(imported);
        notify(`已替换为 ${imported.length} 条笔记`);
      } else {
        // Never rebuild the vault through a title-keyed map: local notes that
        // share a title must survive an import untouched.
        const { notes: merged, added, updated } = mergeVaultNotes(notes, imported);
        await onReplaceAll(merged);
        notify(`导入完成：新增 ${added} 条，更新 ${updated} 条，共 ${merged.length} 条`);
      }
      refreshUsage();
    } catch (error) {
      notify(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    const first = window.confirm(`确定要删除全部 ${notes.length} 条笔记吗？建议先导出备份。`);
    if (!first) return;
    const second = window.confirm('此操作不可撤销。再次确认删除全部笔记？');
    if (!second) return;
    try {
      await onClearAll();
      notify('已清空笔记库');
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
      notify(`当前地址：${url}`);
    }
  };

  const usedText = usage
    ? `${formatBytes(usage.usage)}${usage.quota ? ` / ${formatBytes(usage.quota)}` : ''}`
    : '统计中…';

  return (
    <div className="screen settings-screen">
      <header className="screen-header app-header">
        <div className="app-brand">
          <span className="app-logo" aria-hidden="true">
            砚
          </span>
          <div className="app-brand-text">
            <h1 className="app-title">设置</h1>
            <p className="app-subtitle">数据、外观与关于</p>
          </div>
        </div>
      </header>

      <div className="screen-body">
        <section>
          <div className="section-label">数据</div>
          <div className="settings-card">
            <SettingsRow
              icon="download"
              label="导出全部笔记（JSON）"
              hint={`${notes.length} 条 · 完整保留链接与时间`}
              onClick={handleExportJson}
            />
            <SettingsRow
              icon="book"
              label="导出 Markdown 合集"
              hint="单个 .md 文件，方便迁移到其他工具"
              onClick={handleExportMarkdown}
            />
            <SettingsRow
              icon="upload"
              label="导入笔记（合并）"
              hint="按标题合并，较新的版本优先"
              onClick={() => void handleImport('merge')}
            />
            <SettingsRow
              icon="database"
              label="导入笔记（替换全部）"
              hint="用备份完全覆盖当前笔记库"
              onClick={() => void handleImport('replace')}
            />
            <SettingsRow
              icon="trash"
              label="清空全部笔记"
              hint="不可撤销，建议先导出备份"
              onClick={() => void handleClear()}
              danger
            />
          </div>
          {busy ? <p className="settings-note">正在处理文件…</p> : null}
        </section>

        <section>
          <div className="section-label">存储</div>
          <div className="settings-card settings-static">
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="database" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">
                  本地存储 · {storageMode === 'indexeddb' ? 'IndexedDB' : 'localStorage（降级模式）'}
                </span>
                <span className="settings-row-hint">已用 {usedText} · 数据不会离开这台设备</span>
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
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">在手机上使用</div>
          <div className="settings-card settings-static">
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="external" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">当前地址</span>
                <span className="settings-row-hint">{window.location.host || '本地文件 (file://)'}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void handleCopyLink()}>
                复制
              </button>
            </div>
          </div>
          <p className="settings-note">
            手机和电脑连同一个 Wi-Fi，在电脑上运行 <code>npm run share</code>，用手机扫描终端里的二维码即可打开；也可以把当前页面「添加到主屏幕」。
          </p>
        </section>

        <section>
          <div className="section-label">关于</div>
          <div className="settings-card">
            {welcomeNote ? (
              <SettingsRow
                icon="sparkles"
                label="打开示例笔记"
                hint="看看 Inkstone 能做什么"
                onClick={() => onOpenNote(welcomeNote.id)}
              />
            ) : null}
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="info" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">Inkstone 砚 · v{APP_VERSION}</span>
                <span className="settings-row-hint">MIT 协议开源 · 本地优先的 Markdown 知识库</span>
              </span>
            </div>
            <div className="settings-row as-static">
              <span className="settings-row-icon">
                <Icon name="warn" size={19} />
              </span>
              <span className="settings-row-text">
                <span className="settings-row-label">备份提醒</span>
                <span className="settings-row-hint">
                  清除浏览器数据会丢失笔记，重要内容请定期导出 JSON。
                </span>
              </span>
            </div>
          </div>
        </section>

        <p className="settings-footer">用 Inkstone 写下此刻的想法 · 数据属于你</p>
      </div>
    </div>
  );
}
