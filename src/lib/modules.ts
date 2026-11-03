import type { IconName } from '../components/Icon';
import type { Route } from './useRoute';

/** User-facing LifeOS modules. The list is a template: users can hide modules. */
export type ModuleId =
  | 'experience'
  | 'plan'
  | 'profile'
  | 'health'
  | 'finance'
  | 'templates'
  | 'archive'
  | 'attachments';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;
  icon: IconName;
  route: Route;
  /** Modules that live in the bottom navigation and cannot be hidden. */
  fixed?: boolean;
}

export const MODULES: readonly ModuleDef[] = [
  { id: 'experience', label: '经历库', description: '所有记录的时间线', icon: 'notes', route: { name: 'records' }, fixed: true },
  { id: 'plan', label: '计划', description: '目标、待办与进度', icon: 'checkbox', route: { name: 'plan' }, fixed: true },
  { id: 'profile', label: '个人画像', description: '从记录里看见自己', icon: 'sparkles', route: { name: 'profile' } },
  { id: 'health', label: '健康数据', description: '睡眠、步数、体重趋势', icon: 'heart', route: { name: 'health' } },
  { id: 'finance', label: '理财', description: '收支与分类汇总', icon: 'tag', route: { name: 'finance' } },
  { id: 'templates', label: '模板', description: '可复用的记录骨架', icon: 'book', route: { name: 'templates' } },
  { id: 'archive', label: '归档', description: '收起的记录', icon: 'database', route: { name: 'archive' } },
  { id: 'attachments', label: '附件', description: '图片与文件（规划中）', icon: 'link', route: { name: 'attachments' }, fixed: false },
];

const HIDDEN_KEY = 'mashu.modules.v1';

export function getHiddenModules(): Set<ModuleId> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return new Set();
    const ids = new Set(MODULES.map((module) => module.id));
    return new Set(list.filter((id): id is ModuleId => typeof id === 'string' && ids.has(id as ModuleId)));
  } catch {
    return new Set();
  }
}

export function setModuleHidden(id: ModuleId, hidden: boolean): Set<ModuleId> {
  const current = getHiddenModules();
  if (hidden) current.add(id);
  else current.delete(id);
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...current]));
  } catch {
    /* ignore */
  }
  return current;
}

export function visibleModules(hidden: Set<ModuleId>): ModuleDef[] {
  return MODULES.filter((module) => module.fixed || !hidden.has(module.id));
}
