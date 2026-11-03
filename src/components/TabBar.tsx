import { Icon, type IconName } from './Icon';
import type { TabName } from '../lib/useRoute';

export interface TabBarProps {
  active: TabName;
  onChange: (tab: TabName) => void;
}

const TABS: ReadonlyArray<{ name: TabName; label: string; icon: IconName; en: string }> = [
  { name: 'today', label: '今日', icon: 'sun', en: 'TODAY' },
  { name: 'records', label: '经历', icon: 'notes', en: 'LIFE' },
  { name: 'plan', label: '计划', icon: 'checkbox', en: 'PLAN' },
  { name: 'agent', label: '助手', icon: 'sparkles', en: 'AGENT' },
  { name: 'more', label: '更多', icon: 'more', en: 'MORE' },
];

/** Flat, lean bottom navigation. */
export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((tab) => {
        const isActive = tab.name === active;
        return (
          <button
            key={tab.name}
            type="button"
            className={`tab-item${isActive ? ' is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab.name)}
          >
            <Icon name={tab.icon} size={20} />
            <span className="tab-label">{tab.label}</span>
            <span className="tab-en mono">{tab.en}</span>
          </button>
        );
      })}
    </nav>
  );
}
