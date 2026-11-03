import { Icon, type IconName } from './Icon';

export type EditorCommand =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'list'
  | 'task'
  | 'quote'
  | 'code'
  | 'link'
  | 'wiki'
  | 'divider';

const COMMANDS: ReadonlyArray<{ command: EditorCommand; icon: IconName; label: string }> = [
  { command: 'bold', icon: 'bold', label: '加粗' },
  { command: 'italic', icon: 'italic', label: '斜体' },
  { command: 'heading', icon: 'heading', label: '标题' },
  { command: 'list', icon: 'list', label: '列表' },
  { command: 'task', icon: 'checkbox', label: '待办' },
  { command: 'quote', icon: 'quote', label: '引用' },
  { command: 'code', icon: 'code', label: '代码块' },
  { command: 'link', icon: 'link', label: '链接' },
  { command: 'wiki', icon: 'book', label: '双向链接' },
  { command: 'divider', icon: 'hash', label: '分隔线' },
];

export interface EditorToolbarProps {
  onCommand: (command: EditorCommand) => void;
}

/** Compact Markdown toolbar that sits above the mobile keyboard. */
export function EditorToolbar({ onCommand }: EditorToolbarProps) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Markdown 工具栏">
      {COMMANDS.map((item) => (
        <button
          key={item.command}
          type="button"
          className="tool-btn"
          aria-label={item.label}
          title={item.label}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onCommand(item.command)}
        >
          <Icon name={item.icon} size={20} />
        </button>
      ))}
    </div>
  );
}
