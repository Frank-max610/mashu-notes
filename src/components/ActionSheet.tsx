import { useEffect } from 'react';
import { Icon, type IconName } from './Icon';

export interface ActionSheetItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

export interface ActionSheetProps {
  open: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
}

/** Mobile-friendly bottom action sheet. */
export function ActionSheet({ open, title, items, onClose }: ActionSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? '更多操作'}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <div className="sheet-title">{title}</div> : null}
        <div className="sheet-items">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`sheet-item${item.danger ? ' is-danger' : ''}`}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={20} /> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
