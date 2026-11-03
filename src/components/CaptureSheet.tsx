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

/** Values owned by the structured detail rows while the sheet is open. */
interface QuickFields {
  meal: MealSlot | null;
  calories: string;
  amount: string;
  metric: HealthMetric | null;
  value: string;
  unit: string;
  category: string;
  direction: FinanceDirection;
  dishes: string;
  mood: string;
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
  dishes: '',
  mood: '',
};

/** Below this confidence the compact card gets a quiet "please check" hint. */
const LOW_CONFIDENCE = 0.55;

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

/** Split a free-form dish list ("牛肉面、豆浆") into meta.dishes. */
function splitDishes(value: string): string[] {
  return value
    .split(/[、,，;；\s]+/u)
    .map((dish) => dish.trim())
    .filter((dish) => dish.length > 0);
}

/** One short line for the compact parse card: type · facts. */
function compactFacts(kind: NoteKind, meta: NoteMeta): string[] {
  const facts: string[] = [];
  const amount = meta.amount !== undefined ? `¥${formatAmount(meta.amount)}` : '';
  switch (kind) {
    case 'food':
      if (meta.meal && meta.meal !== '未分类') facts.push(meta.meal);
      if (amount) facts.push(amount);
      if (meta.calories !== undefined) facts.push(`${formatAmount(meta.calories)} 千卡`);
      break;
    case 'health':
      if (meta.metric) {
        const value =
          meta.value !== undefined
            ? ` ${formatAmount(meta.value)}${meta.unit ? ` ${meta.unit}` : ''}`
            : '';
        facts.push(`${meta.metric}${value}`);
      } else if (meta.value !== undefined) {
        facts.push(`${formatAmount(meta.value)}${meta.unit ? ` ${meta.unit}` : ''}`);
      }
      break;
    case 'finance':
      facts.push(meta.direction === 'income' ? '收入' : '支出');
      if (amount) facts.push(amount);
      if (meta.category) facts.push(meta.category);
      break;
    default:
      break;
  }
  if (meta.mood) facts.push(meta.mood);
  return facts;
}

/**
 * Bottom sheet for one-sentence life records, 麻薯 §08 flow:
 * the input is the hero, a single compact parse card confirms what was
 * understood (type · meal · amount · kcal), and every structured field lives
 * behind an 「展开详情」 toggle in lean rows. The textarea is parsed live with
 * the offline agent (`captureDraft`); preview and detail rows share one merged
 * meta object, so what the user sees is exactly what gets saved. App renders
 * this near the root; the component owns its overlay, scroll lock and Escape.
 */
export function CaptureSheet({ open, onClose, onSave, now, initialKind }: CaptureSheetProps) {
  const [text, setText] = useState('');
  const [kindHint, setKindHint] = useState<NoteKind | null>(null);
  const [quick, setQuick] = useState<QuickFields>(EMPTY_QUICK);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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
  const hasDetailFields = effectiveKind !== null && effectiveKind !== 'note';
  const lowConfidence = Boolean(
    parsed && Number.isFinite(parsed.confidence) && parsed.confidence < LOW_CONFIDENCE,
  );

  // Fresh sheet on every open: one-sentence input focused, details collapsed,
  // body scroll locked, Escape wired.
  useEffect(() => {
    if (!open) return;
    setText('');
    setKindHint(initialKindRef.current ?? null);
    setQuick(EMPTY_QUICK);
    setDetailsOpen(false);
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

  // Re-seed the detail rows whenever the parse changes (new text or kind).
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
      dishes: meta?.dishes?.join('、') ?? '',
      mood: meta?.mood ?? '',
    });
  }, [parsed]);

  // When the detail rows open on a short viewport, keep them in view.
  useEffect(() => {
    if (!detailsOpen) return;
    const body = bodyRef.current;
    if (!body) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = requestAnimationFrame(() => {
      body.scrollTo({ top: body.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [detailsOpen]);

  /** Parsed meta with the detail-row edits layered on top. */
  const mergedMeta = useMemo<NoteMeta>(() => {
    const meta: NoteMeta = { ...(parsed?.meta ?? {}), occurredAt: parsed?.meta.occurredAt ?? nowMs };
    if (effectiveKind === 'food') {
      if (quick.meal) meta.meal = quick.meal;
      const calories = toNumber(quick.calories);
      if (calories !== undefined) meta.calories = calories;
      const amount = toNumber(quick.amount);
      if (amount !== undefined) meta.amount = amount;
      const dishes = splitDishes(quick.dishes);
      if (dishes.length > 0) meta.dishes = dishes;
      else delete meta.dishes;
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
    const mood = quick.mood.trim();
    if (mood) meta.mood = mood;
    else delete meta.mood;
    return meta;
  }, [parsed, effectiveKind, quick, nowMs]);

  const summary = useMemo(
    () => (effectiveKind ? compactFacts(effectiveKind, mergedMeta) : []),
    [effectiveKind, mergedMeta],
  );

  /** Whether the detail rows hold anything the user actually entered. */
  const hasQuickInput =
    quick.meal !== null ||
    quick.calories.trim().length > 0 ||
    quick.amount.trim().length > 0 ||
    quick.metric !== null ||
    quick.value.trim().length > 0 ||
    quick.category.trim().length > 0 ||
    quick.dishes.trim().length > 0 ||
    quick.mood.trim().length > 0;

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

  const updateMeal = (value: string): void => {
    setQuick((prev) => ({ ...prev, meal: value as MealSlot }));
  };

  const updateMetric = (value: string): void => {
    setQuick((prev) => {
      const metric = (value || null) as HealthMetric | null;
      const defaultUnit = metric ? HEALTH_UNITS[metric] : '';
      const unit = prev.unit.trim() && prev.metric && HEALTH_UNITS[prev.metric] !== prev.unit ? prev.unit : defaultUnit;
      return { ...prev, metric, unit };
    });
  };

  // One quiet hint line + the disclosure toggle live together under the card.
  const parseHint = parsed
    ? lowConfidence
      ? '识别把握不高，可在详情里改一改'
      : ''
    : trimmed
      ? effectiveKind
        ? '还没识别出结构，可展开详情手动填'
        : '将作为普通记录保存'
      : '';

  const panelClasses = [
    'capture-sheet__panel',
    parsed ? 'is-parsed' : '',
    detailsOpen ? 'is-expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="capture-sheet" role="presentation" onClick={onClose}>
      <div
        className={panelClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="capture-sheet__grip" aria-hidden="true" />

        <header className="capture-sheet__head">
          <div className="capture-sheet__heading">
            <h2 className="capture-sheet__title" id="capture-sheet-title">
              记一笔
            </h2>
            <p className="capture-sheet__subtitle">一句话，或者直接填</p>
          </div>
          <button type="button" className="icon-btn capture-sheet__close" aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div ref={bodyRef} className="capture-sheet__body scroll-area">
          <div className="capture-sheet__kinds" role="group" aria-label="记录类型">
            {KIND_CHOICES.map((choice) => {
              const active = kindHint === choice.id;
              const info = choice.id ? KIND_INFO[choice.id] : null;
              return (
                <button
                  key={choice.label}
                  type="button"
                  className={`capture-sheet__kind${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  style={
                    active
                      ? { borderBottomColor: info ? `var(${info.accentVar})` : 'var(--accent)', color: 'var(--text)' }
                      : undefined
                  }
                  onClick={() => setKindHint(choice.id)}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>

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

          {parsed ? (
            <div className="capture-sheet__parse" aria-live="polite">
              <span
                className="capture-sheet__parse-kind"
                style={{ color: `var(${KIND_INFO[parsed.kind].accentVar})` }}
              >
                {KIND_INFO[parsed.kind].label}
              </span>
              {summary.length > 0 ? (
                <span className="capture-sheet__parse-facts">
                  {summary.map((fact, index) => (
                    <span className="capture-sheet__parse-fact" key={`${fact}-${index}`}>
                      <span className="capture-sheet__parse-sep" aria-hidden="true">
                        ·
                      </span>
                      {fact}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}

          {parseHint || (hasDetailFields && trimmed) || (hasDetailFields && kindHint) ? (
            <div className="capture-sheet__parse-meta">
              {parseHint ? (
                <p className="capture-sheet__parse-hint" role="status">
                  {parseHint}
                </p>
              ) : null}
              {hasDetailFields && (parsed || trimmed || kindHint) ? (
                <button
                  type="button"
                  className="capture-sheet__details-toggle"
                  aria-expanded={detailsOpen}
                  aria-controls="capture-sheet-details"
                  onClick={() => setDetailsOpen((value) => !value)}
                >
                  <span>{detailsOpen ? '收起详情' : '展开详情'}</span>
                  <Icon
                    name="chevronDown"
                    size={16}
                    className={`capture-sheet__chevron${detailsOpen ? ' is-open' : ''}`}
                  />
                </button>
              ) : null}
            </div>
          ) : null}

          {detailsOpen && hasDetailFields ? (
            <div className="capture-sheet__details rise-in" id="capture-sheet-details">
              {effectiveKind === 'food' ? (
                <>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">餐次</span>
                    <select
                      className="capture-sheet__row-control"
                      value={quick.meal ?? '未分类'}
                      onChange={(event) => updateMeal(event.target.value)}
                    >
                      {MEAL_SLOTS.map((meal) => (
                        <option key={meal} value={meal}>
                          {meal}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">热量（千卡）</span>
                    <input
                      className="capture-sheet__row-control"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      placeholder="620"
                      value={quick.calories}
                      onChange={(event) => setQuick((prev) => ({ ...prev, calories: event.target.value }))}
                    />
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">花费（元）</span>
                    <input
                      className="capture-sheet__row-control"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="32"
                      value={quick.amount}
                      onChange={(event) => setQuick((prev) => ({ ...prev, amount: event.target.value }))}
                    />
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">菜品</span>
                    <input
                      className="capture-sheet__row-control"
                      type="text"
                      placeholder="牛肉面、豆浆"
                      value={quick.dishes}
                      onChange={(event) => setQuick((prev) => ({ ...prev, dishes: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}

              {effectiveKind === 'health' ? (
                <>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">指标</span>
                    <select
                      className="capture-sheet__row-control"
                      value={quick.metric ?? ''}
                      onChange={(event) => updateMetric(event.target.value)}
                    >
                      <option value="">未选择</option>
                      {HEALTH_METRICS.map((metric) => (
                        <option key={metric} value={metric}>
                          {metric}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">数值</span>
                    <input
                      className="capture-sheet__row-control"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      placeholder="52.4"
                      value={quick.value}
                      onChange={(event) => setQuick((prev) => ({ ...prev, value: event.target.value }))}
                    />
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">单位</span>
                    <input
                      className="capture-sheet__row-control"
                      type="text"
                      maxLength={6}
                      placeholder="kg"
                      value={quick.unit}
                      onChange={(event) => setQuick((prev) => ({ ...prev, unit: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}

              {effectiveKind === 'finance' ? (
                <>
                  <div className="capture-sheet__row">
                    <span className="capture-sheet__row-label">方向</span>
                    <div className="capture-sheet__segmented" role="group" aria-label="收支方向">
                      {(['expense', 'income'] as const).map((direction) => (
                        <button
                          key={direction}
                          type="button"
                          className={`capture-sheet__segment${quick.direction === direction ? ' is-active' : ''}`}
                          aria-pressed={quick.direction === direction}
                          onClick={() => setQuick((prev) => ({ ...prev, direction }))}
                        >
                          {direction === 'expense' ? '支出' : '收入'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">金额（元）</span>
                    <input
                      className="capture-sheet__row-control"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="32"
                      value={quick.amount}
                      onChange={(event) => setQuick((prev) => ({ ...prev, amount: event.target.value }))}
                    />
                  </label>
                  <label className="capture-sheet__row">
                    <span className="capture-sheet__row-label">分类</span>
                    <select
                      className="capture-sheet__row-control"
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
                </>
              ) : null}

              {effectiveKind === 'diary' ? (
                <label className="capture-sheet__row">
                  <span className="capture-sheet__row-label">心情</span>
                  <input
                    className="capture-sheet__row-control"
                    type="text"
                    maxLength={12}
                    placeholder="平静"
                    value={quick.mood}
                    onChange={(event) => setQuick((prev) => ({ ...prev, mood: event.target.value }))}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="capture-sheet__footer">
          {error ? (
            <p className="capture-sheet__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="capture-sheet__actions">
            <button type="button" className="capture-sheet__cancel" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="capture-sheet__save"
              disabled={!draft || saving}
              onClick={() => void handleSave()}
            >
              {saving ? '保存中…' : '保存记录'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
