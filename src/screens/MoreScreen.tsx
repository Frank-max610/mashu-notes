import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { MODULES, visibleModules, type ModuleId } from '../lib/modules';
import { MochiNode } from '../components/MochiNode';
import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../lib/useRoute';

export interface MoreScreenProps {
  notes: Note[];
  hiddenModules: Set<ModuleId>;
  onToggleModule: (id: ModuleId, hidden: boolean) => void;
  onOpenRoute: (route: Parameters<typeof navigate>[0]) => void;
  onOpenNote: (id: string) => void;
}

/** 更多 — LifeOS modules, manage-your-own-template controls, help and settings. */
export function MoreScreen({ notes, hiddenModules, onToggleModule, onOpenRoute, onOpenNote }: MoreScreenProps) {
  const shown = useMemo(() => visibleModules(hiddenModules), [hiddenModules]);
  const helpNotes = useMemo(
    () => notes.filter((note) => note.tags.includes('使用手册') || note.title === '开始这里').slice(0, 2),
    [notes],
  );

  const tools: ReadonlyArray<{ label: string; icon: IconName; onClick: () => void }> = [
    { label: '生活图谱', icon: 'graph', onClick: () => onOpenRoute({ name: 'graph' }) },
    { label: '设置', icon: 'settings', onClick: () => onOpenRoute({ name: 'settings' }) },
  ];

  return (
    <div className="screen more-screen">
      <header className="screen-header">
        <div className="brand-row">
          <MochiNode size={26} />
          <div className="brand-copy">
            <h1 className="page-title">更多</h1>
            <p className="brand-date">你的 LifeOS 模块</p>
          </div>
        </div>
      </header>
      <div className="screen-body more-body">
        <section aria-label="功能模块">
          <div className="section-label">模块</div>
          <div className="module-grid">
            {shown.filter((module) => !module.fixed).map((module) => (
              <button
                key={module.id}
                type="button"
                className="module-card"
                onClick={() => onOpenRoute(module.route)}
              >
                <span className="module-icon"><Icon name={module.icon} size={20} /></span>
                <span className="module-name">{module.label}</span>
                <span className="module-desc">{module.description}</span>
              </button>
            ))}
            {tools.map((tool) => (
              <button key={tool.label} type="button" className="module-card" onClick={tool.onClick}>
                <span className="module-icon"><Icon name={tool.icon} size={20} /></span>
                <span className="module-name">{tool.label}</span>
                <span className="module-desc">{tool.label === '设置' ? '外观、数据、健康与关于' : '记录之间的关系'}</span>
              </button>
            ))}
          </div>
        </section>

        {helpNotes.length > 0 ? (
          <section aria-label="开始使用">
            <div className="section-label">开始</div>
            <div className="settings-card">
              {helpNotes.map((note) => (
                <button key={note.id} type="button" className="settings-row" onClick={() => onOpenNote(note.id)}>
                  <span className="settings-row-icon"><Icon name="book" size={18} /></span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">{note.title}</span>
                    <span className="settings-row-hint">用一分钟了解麻薯怎么用</span>
                  </span>
                  <Icon name="arrowRight" size={15} />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-label="自定义模块">
          <div className="section-label">自定义</div>
          <div className="settings-card">
            {MODULES.filter((module) => !module.fixed).map((module) => {
              const hidden = hiddenModules.has(module.id);
              return (
                <label className="settings-row module-toggle" key={module.id}>
                  <span className="settings-row-icon"><Icon name={module.icon} size={18} /></span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">{module.label}</span>
                    <span className="settings-row-hint">模块是模板，可以随时隐藏</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={(event) => onToggleModule(module.id, !event.target.checked)}
                    aria-label={`显示${module.label}模块`}
                  />
                </label>
              );
            })}
          </div>
          <p className="settings-note">隐藏的模块不会出现在“更多”里，记录本身不会被删除。</p>
        </section>
      </div>
    </div>
  );
}
