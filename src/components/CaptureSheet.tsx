import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  FinanceDirection,
  HealthMetric,
  MealSlot,
  NoteKind,
  NoteMeta,
  RecordDraft,
} from '../lib/types';
import {
  FINANCE_CATEGORIES,
  HEALTH_METRICS,
  HEALTH_UNITS,
  KIND_INFO,
  MEAL_SLOTS,
  defaultTitle,
  formatAmount,
} from '../lib/kinds';
import { captureDraft } from '../lib/agent';
import { Icon } from './Icon';
import './CaptureSheet.css';

export interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
  onSave: (draft: RecordDraft) => Promise<void> | void;
  /** Frozen "now" used by the parser (tests / deterministic screenshots). */
  now?: Date;
  /** Pre-select a record kind when the sheet opens (home quick actions). */
  initialKind?: NoteKind;
}

interface KindChoice {
  id: NoteKind | null;
  label: string;
}

const KIND_CHOICES: readonly KindChoice[] = [
  { id: null, label: '自动' },
  { id: 'diary', label: '日记' },
  { id: 'food', label: '饮食' },
  { id: 'health', label: '健康' },
  { id: 'finance', label: '理财' },
];

/** Values owned by the quick structured fields while the sheet is open. */
interface QuickFields {
  meal: MealSlot | null;
  calories: string;
  amount: string;
  metric: HealthMetric | null;
  value: string;
  unit: string;
  category: string;
  direction: FinanceDirection;
}

const EMPTY_QUICK: QuickFields = {
  meal: null,
  calories: '',
  amount: '',
  metric: null,
  value: '',
  unit: '',
  category: '',
  direction: 'expense',
};

interface Fact {
  label: string;
  value: string;
}

function toNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Short human title for unstructured text (first line, length-capped). */
function shortTitle(text: string): string {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return '';
  return line.length > 18 ? `${line.slice(0, 18)}…` : line;
}

/** Structured fields shown in the live preview / confirm cards. */
function metaFacts(kind: NoteKind, meta: NoteMeta): Fact[] {
  const facts: Fact[] = [];
  const amount = meta.amount !== undefined ? `¥${formatAmount(meta.amount)}` : '';
  switch (kind) {
    case 'food':
      if (meta.meal && meta.meal !== '未分类') facts.push({ label: '餐次', value: meta.meal });
      if (meta.calories !== undefined) {
        facts.push({ label: '热量', value: `${formatAmount(meta.calories)} 千卡` });
      }
      if (amount) facts.push({ label: '花费', value: amount });
      if (meta.dishes && meta.dishes.length > 0) {
        facts.push({ label: '菜品', value: meta.dishes.join('、') });
      }
      break;
    case 'health':
      if (meta.metric) facts.push({ label: '指标', value: meta.metric });
      if (meta.value !== undefined) {
        facts.push({
          label: '数值',
          value: `${formatAmount(meta.value)}${meta.unit ? ` ${meta.unit}` : ''}`,
        });
      }
      break;
    case 'finance':
      facts.push({ label: '方向', value: meta.direction === 'income' ? '收入' : '支出' });
      if (amount) facts.push({ label: '金额', value: amount });
      if (meta.category) facts.push({ label: '分类', value: meta.category });
      break;
    default:
      break;
  }
  if (meta.mood) facts.push({ label: '心情', value: meta.mood });
  return facts;
}

/**
 * Bottom sheet for capturing one life record.
 *
 * The textarea is parsed live with the offline agent (`captureDraft`); the
 * preview and the optional quick fields stay in sync with a merged meta object
 * so what the user sees is exactly what gets saved. App renders this component
 * near the root; it owns its fixed overlay, scroll lock and Escape handling.
 */
export function CaptureSheet({ open, onClose, onSave, now, initialKind }: CaptureSheetProps) {
  const [text, setText] = useState('');
  const [kindHint, setKindHint] = useState<NoteKind | null>(null);
  const [quick, setQuick] = useState<QuickFields>(EMPTY_QUICK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialKindRef = useRef(initialKind);
  initialKindRef.current = initialKind;

  // Freeze the parser clock per open: App may pass an inline `new Date()` which
  // changes identity on every render, and the quick-field sync below must not
  // be reset by unrelated parent renders.
  const [parserNow, setParserNow] = useState<Date>(() => now ?? new Date());
  const nowMs = parserNow.getTime();

  const trimmed = text.trim();
  const parsed = useMemo(
    () => (trimmed ? captureDraft(trimmed, kindHint ?? undefined, parserNow) : null),
    [trimmed, kindHint, parserNow],
  );
  const effectiveKind: NoteKind | null = parsed?.kind ?? kindHint ?? null;

  // Fresh sheet on every open: clear the textarea, honour the requested kind,
  // lock body scroll and focus the textarea (mobile keyboards are picky).
  useEffect(() => {
    if (!open) return;
    setText('');
    setKindHint(initialKindRef.current ?? null);
    setQuick(EMPTY_QUICK);
    setSaving(false);
    setError(null);
    setParserNow(now ?? new Date());
    const frame = requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Re-seed the quick fields whenever the parse changes (new text or kind).
  useEffect(() => {
    const meta = parsed?.meta;
    setQuick({
      meal: meta?.meal ?? null,
      calories: meta?.calories !== undefined ? String(meta.calories) : '',
      amount: meta?.amount !== undefined ? String(meta.amount) : '',
      metric: meta?.metric ?? null,
      value: meta?.value !== undefined ? String(meta.value) : '',
      unit: meta?.unit ?? '',
      category: meta?.category ?? '',
      direction: meta?.direction ?? 'expense',
    });
  }, [parsed]);

  /** Parsed meta with the quick-field edits layered on top. */
  const mergedMeta = useMemo<NoteMeta>(() => {
    const meta: NoteMeta = { ...(parsed?.meta ?? {}), occurredAt: parsed?.meta.occurredAt ?? nowMs };
    if (effectiveKind === 'food') {
      if (quick.meal) meta.meal = quick.meal;
      const calories = toNumber(quick.calories);
      if (calories !== undefined) meta.calories = calories;
      const amount = toNumber(quick.amount);
      if (amount !== undefined) meta.amount = amount;
    } else if (effectiveKind === 'health') {
      if (quick.metric) meta.metric = quick.metric;
      const value = toNumber(quick.value);
      if (value !== undefined) meta.value = value;
      const unit = quick.unit.trim() || (quick.metric ? HEALTH_UNITS[quick.metric] : '');
      if (unit) meta.unit = unit;
      else delete meta.unit;
    } else if (effectiveKind === 'finance') {
      meta.direction = quick.direction;
      const amount = toNumber(quick.amount);
      if (amount !== undefined) meta.amount = amount;
      if (quick.category) meta.category = quick.category;
    }
    return meta;
  }, [parsed, effectiveKind, quick, nowMs]);

  const facts = useMemo(
    () => (effectiveKind ? metaFacts(effectiveKind, mergedMeta) : []),
    [effectiveKind, mergedMeta],
  );

  /** Whether the quick fields hold anything the user actually entered. */
  const hasQuickInput =
    quick.meal !== null ||
    quick.calories.trim().length > 0 ||
    quick.amount.trim().length > 0 ||
    quick.metric !== null ||
    quick.value.trim().length > 0 ||
    quick.category.trim().length > 0;

  /** The draft that "保存记录" will hand to the app. */
  const draft = useMemo<RecordDraft | null>(() => {
    if (parsed) {
      return {
        ...parsed,
        kind: kindHint ?? parsed.kind,
        title: parsed.title.trim() || shortTitle(trimmed) || '未命名记录',
        meta: mergedMeta,
      };
    }
    if (!effectiveKind) {
      if (!trimmed) return null;
      return {
        kind: 'note',
        title: shortTitle(trimmed) || '未命名笔记',
        content: trimmed,
        meta: mergedMeta,
        confidence: 0.25,
      };
    }
    const title = shortTitle(trimmed) || defaultTitle(effectiveKind, parserNow);
    if (!trimmed && !hasQuickInput) return null;
    return {
      kind: effectiveKind,
      title,
      content: trimmed || title,
      meta: mergedMeta,
      confidence: 0.3,
    };
  }, [parsed, kindHint, effectiveKind, mergedMeta, trimmed, parserNow, hasQuickInput]);

  if (!open) return null;

  const handleSave = async (): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch {
      setError('保存失败，请再试一次');
    } finally {
      setSaving(false);
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl+Enter saves quickly on desktop; plain Enter keeps newlines.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSave();
    }
  };

  const confidence =
    parsed && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;

  return (
    <div className="capture-sheet" role="presentation" onClick={onClose}>
      <div
        className="capture-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capture-sheet__head">
          <div className="capture-sheet__heading">
            <h2 className="capture-sheet__title" id="capture-sheet-title">
              记一笔
            </h2>
            <p className="capture-sheet__subtitle">用一句话，或者直接填</p>
          </div>
          <button type="button" className="icon-btn capture-sheet__close" aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={19} />
          </button>
        </header>

        <div className="capture-sheet__body scroll-area">
          <div className="capture-sheet__kinds" role="group" aria-label="记录类型">
            {KIND_CHOICES.map((choice) => {
              const active = kindHint === choice.id;
              const info = choice.id ? KIND_INFO[choice.id] : null;
              return (
                <button
                  key={choice.label}
                  type="button"
                  className={`chip capture-sheet__kind${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  style={
                    active && info
                      ? {
                          background: `var(${info.accentSoftVar})`,
                          borderColor: `var(${info.accentVar})`,
                          color: `var(${info.accentVar})`,
                        }
                      : undefined
                  }
                  onClick={() => setKindHint(choice.id)}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>

          <div className="capture-sheet__input-block">
            <textarea
              ref={textareaRef}
              className="capture-sheet__textarea"
              value={text}
              rows={2}
              placeholder="例如：午饭牛肉面 32 元，620 大卡"
              aria-label="一句话记录"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
            />
          </div>

          {parsed ? (
            <div className="capture-sheet__preview" aria-live="polite">
              <div className="capture-sheet__preview-head">
                <span
                  className="capture-sheet__kind-badge"
                  style={{
                    background: `var(${KIND_INFO[parsed.kind].accentSoftVar})`,
                    color: `var(${KIND_INFO[parsed.kind].accentVar})`,
                  }}
                >
                  {KIND_INFO[parsed.kind].emoji} {KIND_INFO[parsed.kind].label}
                </span>
                {confidence !== null ? (
                  <span className="capture-sheet__confidence">
                    识别把握 {Math.round(confidence * 100)}%
                  </span>
                ) : null}
              </div>
              <p className="capture-sheet__preview-title">{draft?.title ?? parsed.title}</p>
              {facts.length > 0 ? (
                <dl className="capture-sheet__facts">
                  {facts.map((fact) => (
                    <div className="capture-sheet__fact" key={`${fact.label}-${fact.value}`}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : trimmed || kindHint ? (
            <p className="capture-sheet__hint" role="status">
              <Icon name="info" size={14} />
              <span>还没识别出来，试着写金额或数值</span>
            </p>
          ) : null}

          {effectiveKind === 'food' ? (
            <div className="capture-sheet__quick" aria-label="饮食细节">
              <div className="capture-sheet__quick-row">
                <span className="capture-sheet__quick-label">餐次</span>
                <div className="capture-sheet__chip-row">
                  {MEAL_SLOTS.map((meal) => (
                    <button
                      key={meal}
                      type="button"
                      className={`chip capture-sheet__mini-chip${quick.meal === meal ? ' is-active' : ''}`}
                      aria-pressed={quick.meal === meal}
                      onClick={() => setQuick((prev) => ({ ...prev, meal: prev.meal === meal ? null : meal }))}
                    >
                      {meal}
                    </button>
                  ))}
                </div>
              </div>
              <div className="capture-sheet__field-grid">
                <label className="capture-sheet__field">
                  <span>热量（千卡）</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="620"
                    value={quick.calories}
                    onChange={(event) => setQuick((prev) => ({ ...prev, calories: event.target.value }))}
                  />
                </label>
                <label className="capture-sheet__field">
                  <span>花费（元）</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="32"
                    value={quick.amount}
                    onChange={(event) => setQuick((prev) => ({ ...prev, amount: event.target.value }))}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {effectiveKind === 'health' ? (
            <div className="capture-sheet__quick" aria-label="健康细节">
              <div className="capture-sheet__quick-row">
                <span className="capture-sheet__quick-label">指标</span>
                <div className="capture-sheet__chip-row">
                  {HEALTH_METRICS.map((metric) => (
                    <button
                      key={metric}
                      type="button"
                      className={`chip capture-sheet__mini-chip${quick.metric === metric ? ' is-active' : ''}`}
                      aria-pressed={quick.metric === metric}
                      onClick={() =>
                        setQuick((prev) => ({
                          ...prev,
                          metric,
                          unit: prev.metric === metric && prev.unit ? prev.unit : HEALTH_UNITS[metric],
                        }))
                      }
                    >
                      {metric}
                    </button>
                  ))}
                </div>
              </div>
              <div className="capture-sheet__field-grid">
                <label className="capture-sheet__field">
                  <span>数值</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="52.4"
                    value={quick.value}
                    onChange={(event) => setQuick((prev) => ({ ...prev, value: event.target.value }))}
                  />
                </label>
                <label className="capture-sheet__field">
                  <span>单位</span>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="kg"
                    value={quick.unit}
                    onChange={(event) => setQuick((prev) => ({ ...prev, unit: event.target.value }))}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {effectiveKind === 'finance' ? (
            <div className="capture-sheet__quick" aria-label="收支细节">
              <div className="capture-sheet__quick-row">
                <span className="capture-sheet__quick-label">方向</span>
                <div className="capture-sheet__chip-row" role="group" aria-label="收支方向">
                  {(['expense', 'income'] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      className={`chip capture-sheet__mini-chip${quick.direction === direction ? ' is-active' : ''}`}
                      aria-pressed={quick.direction === direction}
                      onClick={() => setQuick((prev) => ({ ...prev, direction }))}
                    >
                      {direction === 'expense' ? '支出' : '收入'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="capture-sheet__field-grid">
                <label className="capture-sheet__field">
                  <span>金额（元）</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="32"
                    value={quick.amount}
                    onChange={(event) => setQuick((prev) => ({ ...prev, amount: event.target.value }))}
                  />
                </label>
                <label className="capture-sheet__field">
                  <span>分类</span>
                  <select
                    value={quick.category}
                    onChange={(event) => setQuick((prev) => ({ ...prev, category: event.target.value }))}
                  >
                    <option value="">未分类</option>
                    {FINANCE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="capture-sheet__footer">
          {error ? (
            <p className="capture-sheet__error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-block capture-sheet__save"
            disabled={!draft || saving}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存记录'}
          </button>
        </footer>
      </div>
    </div>
  );
}
