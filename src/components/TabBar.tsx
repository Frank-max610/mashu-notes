import { Icon, type IconName } from './Icon';
import type { TabName } from '../lib/useRoute';

export interface TabBarProps {
  active: TabName;
  onChange: (tab: TabName) => void;
  /** Small count badge on the notes tab (all notes). */
  notesCount?: number;
}

const TABS: ReadonlyArray<{ name: TabName; label: string; icon: IconName; badge?: boolean }> = [
  { name: 'notes', label: '笔记', icon: 'notes', badge: true },
  { name: 'graph', label: '图谱', icon: 'graph' },
  { name: 'search', label: '搜索', icon: 'search' },
  { name: 'settings', label: '设置', icon: 'settings' },
];

/** Bottom navigation, safe-area aware. */
export function TabBar({ active, onChange, notesCount }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((tab) => {
        const isActive = tab.name === active;
        return (
          <button
            key={tab.name}
            type="button"
            className={`tabbar-item${isActive ? ' is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab.name)}
          >
            <span className="tabbar-icon">
              <Icon name={tab.icon} size={23} />
              {tab.badge && notesCount ? <span className="tabbar-badge">{notesCount}</span> : null}
            </span>
            <span className="tabbar-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
