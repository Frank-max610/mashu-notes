import { Mascot } from './Mascot';

export interface AgentAvatarProps {
  avatar: string;
  size?: number;
  className?: string;
  /** Kept for API compatibility with the previous avatar set. */
  name?: string;
}

const AVATAR_EMOJI: Record<string, string> = {
  cat: '🐱',
  leaf: '🌿',
  sun: '☀️',
  star: '⭐',
  book: '📖',
  tea: '🍵',
  bowl: '🍚',
};

/** Pastel avatar set for the local helper: the mochi mascot, cute emoji, or a custom character. */
export function AgentAvatar({ avatar, size = 40, className }: AgentAvatarProps) {
  const frame = Math.max(22, size);
  const emoji = AVATAR_EMOJI[avatar] ?? avatar;

  if (avatar === 'mochi') {
    return (
      <span
        className={`ag-avatar ag-avatar-mascot${className ? ` ${className}` : ''}`}
        style={{ width: frame, height: frame, borderRadius: Math.round(frame * 0.34) }}
        aria-hidden="true"
      >
        <Mascot size={Math.round(frame * 0.94)} />
      </span>
    );
  }

  return (
    <span
      className={`ag-avatar ag-avatar-emoji${className ? ` ${className}` : ''}`}
      style={{ width: frame, height: frame, borderRadius: Math.round(frame * 0.34) }}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
