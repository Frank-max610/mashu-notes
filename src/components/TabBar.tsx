import { Icon, type IconName } from './Icon';
import type { TabName } from '../lib/useRoute';

export interface TabBarProps {
  active: TabName;
  onChange: (tab: TabName) => void;
  /** Opens a brand-new note (mochi) from the floating centre button. */
  onCompose: () => void;
  /** Small count badge on the notes tab. */
  notesCount?: number;
}

const LEFT_TABS: ReadonlyArray<{ name: TabName; label: string; icon: IconName }> = [
  { name: 'notes', label: '笔记', icon: 'notes' },
  { name: 'graph', label: '图谱', icon: 'graph' },
];

const RIGHT_TABS: ReadonlyArray<{ name: TabName; label: string; icon: IconName }> = [
  { name: 'agent', label: '助手', icon: 'sparkles' },
  { name: 'settings', label: '我的', icon: 'settings' },
];

function TabButton({
  name,
  label,
  icon,
  active,
  notesCount,
  onChange,
}: {
  name: TabName;
  label: string;
  icon: IconName;
  active: boolean;
  notesCount?: number;
  onChange: (tab: TabName) => void;
}) {
  return (
    <button
      type="button"
      className={`tabbar-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onChange(name)}
    >
      <span className="tabbar-icon">
        <Icon name={icon} size={22} />
        {name === 'notes' && notesCount ? <span className="tabbar-badge">{notesCount}</span> : null}
      </span>
      <span className="tabbar-label">{label}</span>
    </button>
  );
}

/** Floating pill navigation with a squishy center compose button. */
export function TabBar({ active, onChange, onCompose, notesCount }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="主导航">
      <div className="tabbar-inner">
        {LEFT_TABS.map((tab) => (
          <TabButton
            key={tab.name}
            {...tab}
            active={tab.name === active}
            notesCount={notesCount}
            onChange={onChange}
          />
        ))}

        <button type="button" className="tabbar-compose" aria-label="捏一颗新麻薯" onClick={onCompose}>
          <Icon name="plus" size={26} strokeWidth={2.4} />
        </button>

        {RIGHT_TABS.map((tab) => (
          <TabButton key={tab.name} {...tab} active={tab.name === active} onChange={onChange} />
        ))}
      </div>
    </nav>
  );
}
