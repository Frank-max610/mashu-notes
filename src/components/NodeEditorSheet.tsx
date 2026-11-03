import { useEffect, useMemo, useState } from 'react';
import type { Note, NoteKind, NoteMeta, NotePosition } from '../lib/types';
import {
  FINANCE_CATEGORIES,
  HEALTH_METRICS,
  HEALTH_UNITS,
  KIND_INFO,
  MEAL_SLOTS,
  NOTE_KINDS,
  defaultTitle,
} from '../lib/kinds';
import { Icon } from './Icon';

export interface NodeEditorValues {
  title: string;
  kind: NoteKind;
  meta: NoteMeta;
  manualLinks: string[];
}

export interface NodeEditorSheetProps {
  open: boolean;
  /** Existing note in edit mode; null when creating a new one. */
  note: Note | null;
  notes: Note[];
  /** Position for newly created nodes (from the graph). */
  position?: NotePosition;
  onClose: () => void;
  onSave: (values: NodeEditorValues) => void;
  onDelete?: () => void;
  onOpenNote?: (id: string) => void;
}

interface FormState {
  title: string;
  kind: NoteKind;
  meal: string;
  calories: string;
  amount: string;
  category: string;
  direction: 'expense' | 'income';
  metric: string;
  value: string;
  mood: string;
  manualLinks: string[];
}

function toForm(note: Note | null): FormState {
  const meta = note?.meta ?? {};
  return {
    title: note?.title ?? '',
    kind: note?.kind ?? 'diary',
    meal: meta.meal ?? '未分类',
    calories: meta.calories !== undefined ? String(meta.calories) : '',
    amount: meta.amount !== undefined ? String(meta.amount) : '',
    category: meta.category ?? '餐饮',
    direction: meta.direction ?? 'expense',
    metric: meta.metric ?? '体重',
    value: meta.value !== undefined ? String(meta.value) : '',
    mood: meta.mood ?? '',
    manualLinks: note?.manualLinks ?? [],
  };
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildMeta(form: FormState, base: NoteMeta): NoteMeta {
  const meta: NoteMeta = { occurredAt: base.occurredAt, direction: base.direction, unit: undefined };
  switch (form.kind) {
    case 'food':
      if (form.meal && form.meal !== '未分类') meta.meal = form.meal as NoteMeta['meal'];
      if (numberOrUndefined(form.calories) !== undefined) meta.calories = numberOrUndefined(form.calories);
      if (numberOrUndefined(form.amount) !== undefined) {
        meta.amount = numberOrUndefined(form.amount);
        meta.direction = 'expense';
        meta.category = meta.category ?? '餐饮';
      }
      break;
    case 'health':
      meta.metric = form.metric as NoteMeta['metric'];
      if (numberOrUndefined(form.value) !== undefined) meta.value = numberOrUndefined(form.value);
      meta.unit = HEALTH_UNITS[form.metric as keyof typeof HEALTH_UNITS] ?? '';
      if (form.mood) meta.mood = form.mood;
      break;
    case 'finance':
      meta.direction = form.direction;
      meta.category = form.category;
      if (numberOrUndefined(form.amount) !== undefined) meta.amount = numberOrUndefined(form.amount);
      break;
    case 'diary':
      if (form.mood) meta.mood = form.mood;
      break;
    default:
      break;
  }
  return meta;
}

/** Bottom sheet used by the life graph to add / edit / delete a node. */
export function NodeEditorSheet({
  open,
  note,
  notes,
  position,
  onClose,
  onSave,
  onDelete,
  onOpenNote,
}: NodeEditorSheetProps) {
  const [form, setForm] = useState<FormState>(() => toForm(note));

  useEffect(() => {
    if (open) setForm(toForm(note));
  }, [open, note]);

  const linkedNotes = useMemo(() => {
    if (!note) return form.manualLinks.map((id) => ({ id, title: notes.find((item) => item.id === id)?.title ?? '已删除' }));
    return form.manualLinks.map((id) => ({
      id,
      title: notes.find((item) => item.id === id)?.title ?? '已删除',
    }));
  }, [form.manualLinks, note, notes]);

  const candidates = useMemo(
    () => notes.filter((item) => item.id !== note?.id && !form.manualLinks.includes(item.id)),
    [form.manualLinks, note?.id, notes],
  );

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSave = () => {
    const kind = form.kind;
    const fallbackTitle = defaultTitle(kind);
    onSave({
      title: form.title.trim() || fallbackTitle,
      kind,
      meta: buildMeta(form, note?.meta ?? {}),
      manualLinks: form.manualLinks,
    });
    void position;
  };

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet node-editor"
        role="dialog"
        aria-modal="true"
        aria-label={note ? '编辑节点' : '添加节点'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="node-editor-head">
          <h2 className="node-editor-title">{note ? '编辑节点' : '添加节点'}</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="node-editor-body scroll-area">
          <label className="field-label" htmlFor="node-title">
            标题
          </label>
          <input
            id="node-title"
            className="field-input"
            value={form.title}
            placeholder="给它起个名字"
            onChange={(event) => update('title', event.target.value)}
          />

          <div className="field-label">类型</div>
          <div className="field-chips">
            {NOTE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`chip${form.kind === kind ? ' is-active' : ''}`}
                style={{
                  ['--kind-accent' as string]: `var(${KIND_INFO[kind].accentVar})`,
                  ['--kind-soft' as string]: `var(${KIND_INFO[kind].accentSoftVar})`,
                }}
                onClick={() => update('kind', kind)}
              >
                {KIND_INFO[kind].label}
              </button>
            ))}
          </div>

          {form.kind === 'food' ? (
            <>
              <div className="field-label">餐次</div>
              <div className="field-chips">
                {MEAL_SLOTS.map((meal) => (
                  <button
                    key={meal}
                    type="button"
                    className={`chip${form.meal === meal ? ' is-active' : ''}`}
                    onClick={() => update('meal', meal)}
                  >
                    {meal}
                  </button>
                ))}
              </div>
              <div className="field-row">
                <label className="field-field">
                  <span className="field-label">热量 (kcal)</span>
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={form.calories}
                    onChange={(event) => update('calories', event.target.value)}
                  />
                </label>
                <label className="field-field">
                  <span className="field-label">花费 (元)</span>
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) => update('amount', event.target.value)}
                  />
                </label>
              </div>
            </>
          ) : null}

          {form.kind === 'health' ? (
            <>
              <div className="field-label">指标</div>
              <div className="field-chips">
                {HEALTH_METRICS.map((metric) => (
                  <button
                    key={metric}
                    type="button"
                    className={`chip${form.metric === metric ? ' is-active' : ''}`}
                    onClick={() => update('metric', metric)}
                  >
                    {metric}
                  </button>
                ))}
              </div>
              <label className="field-field">
                <span className="field-label">
                  数值{form.metric !== '心情' ? `（${HEALTH_UNITS[form.metric as keyof typeof HEALTH_UNITS] ?? ''}）` : ''}
                </span>
                <input
                  className="field-input"
                  inputMode="decimal"
                  value={form.metric === '心情' ? form.mood : form.value}
                  onChange={(event) =>
                    form.metric === '心情'
                      ? update('mood', event.target.value)
                      : update('value', event.target.value)
                  }
                />
              </label>
            </>
          ) : null}

          {form.kind === 'finance' ? (
            <>
              <div className="field-chips">
                <button
                  type="button"
                  className={`chip${form.direction === 'expense' ? ' is-active' : ''}`}
                  onClick={() => update('direction', 'expense')}
                >
                  支出
                </button>
                <button
                  type="button"
                  className={`chip${form.direction === 'income' ? ' is-active' : ''}`}
                  onClick={() => update('direction', 'income')}
                >
                  收入
                </button>
              </div>
              <label className="field-field">
                <span className="field-label">金额 (元)</span>
                <input
                  className="field-input"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => update('amount', event.target.value)}
                />
              </label>
              <div className="field-label">分类</div>
              <div className="field-chips">
                {FINANCE_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`chip${form.category === category ? ' is-active' : ''}`}
                    onClick={() => update('category', category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {note ? (
            <>
              <div className="field-label">手动连线</div>
              {linkedNotes.length > 0 ? (
                <div className="node-link-list">
                  {linkedNotes.map((item) => (
                    <span key={item.id} className="node-link-chip">
                      <button type="button" className="node-link-open" onClick={() => onOpenNote?.(item.id)}>
                        {item.title}
                      </button>
                      <button
                        type="button"
                        className="node-link-remove"
                        aria-label={`断开与 ${item.title} 的连线`}
                        onClick={() =>
                          update(
                            'manualLinks',
                            form.manualLinks.filter((id) => id !== item.id),
                          )
                        }
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="field-hint">还没有手动连线。可以在这里添加，或在图谱里连一条。</p>
              )}
              {candidates.length > 0 ? (
                <select
                  className="field-input"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    update('manualLinks', [...form.manualLinks, event.target.value]);
                  }}
                >
                  <option value="">选择一条记录来连线…</option>
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="node-editor-actions">
          {note && onDelete ? (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              删除
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
