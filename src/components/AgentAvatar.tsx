import type { CSSProperties, ReactNode } from 'react';

export interface AgentAvatarProps {
  avatar: string;
  size?: number;
  className?: string;
  /** Used by the 'initial' preset. */
  name?: string;
}

const PRESET_IDS = new Set(['orb', 'initial', 'ring', 'square', 'triad', 'spark', 'wave', 'grid']);

const GRADIENTS: Record<string, string> = {
  orb: 'linear-gradient(135deg, #ff7a17 0%, #ff4d8d 52%, #8b5cf6 100%)',
  initial: 'linear-gradient(135deg, #8b5cf6 0%, #ff4d8d 100%)',
  ring: 'linear-gradient(140deg, #ff9a4d, #ff4d8d)',
  square: 'linear-gradient(140deg, #8b5cf6, #a0c3ec)',
  triad: 'linear-gradient(140deg, #b6f09c, #a0c3ec)',
  spark: 'linear-gradient(140deg, #ffd166, #ff7a17)',
  wave: 'linear-gradient(140deg, #a0c3ec, #8b5cf6)',
  grid: 'linear-gradient(140deg, #ff4d8d, #8b5cf6)',
};

const GLYPHS: Record<string, ReactNode> = {
  ring: <circle cx="14" cy="14" r="7.5" />,
  square: <rect x="7" y="7" width="14" height="14" rx="2.5" />,
  triad: <path d="M14 6.5 22 21H6z" strokeLinejoin="round" />,
  spark: <path d="M14 5v18M5 14h18M8 8l12 12M20 8 8 20" />,
  wave: <path d="M5 17c3-4.5 6-4.5 9 0s6 4.5 9 0M5 10c3-4.5 6-4.5 9 0s6 4.5 9 0" />,
  grid: (
    <g>
      <path d="M9 5v18M19 5v18M5 9h18M5 19h18" />
    </g>
  ),
};

/**
 * Gradient avatar set for the local helper. Abstract marks only — no mascots,
 * no serif seals. A custom emoji/character still works via the last branch.
 */
export function AgentAvatar({ avatar, size = 40, className, name }: AgentAvatarProps) {
  const preset = PRESET_IDS.has(avatar) ? avatar : null;
  const frame = Math.max(20, size);

  if (preset === 'initial') {
    const initial = (name?.trim()?.[0] ?? '麻').slice(0, 1);
    return (
      <span
        className={`ag-avatar${className ? ` ${className}` : ''}`}
        aria-hidden="true"
        style={{
          width: frame,
          height: frame,
          borderRadius: Math.round(frame * 0.32),
          background: GRADIENTS.initial,
          color: '#fff',
          fontSize: Math.round(frame * 0.46),
          fontWeight: 800,
        }}
      >
        {initial}
      </span>
    );
  }

  if (preset) {
    const style: CSSProperties = {
      width: frame,
      height: frame,
      borderRadius: preset === 'ring' ? '50%' : Math.round(frame * 0.32),
      background: GRADIENTS[preset],
    };
    if (preset === 'orb' || preset === 'initial') {
      return (
        <span className={`ag-avatar ag-avatar-orb${className ? ` ${className}` : ''}`} aria-hidden="true" style={style}>
          <span className="ag-avatar-gloss" />
        </span>
      );
    }
    return (
      <span className={`ag-avatar ag-avatar-glyph${className ? ` ${className}` : ''}`} aria-hidden="true" style={style}>
        <svg viewBox="0 0 28 28" width="100%" height="100%" fill="none" stroke="rgba(255,255,255,0.94)" strokeWidth="1.8" strokeLinecap="round">
          {GLYPHS[preset]}
        </svg>
      </span>
    );
  }

  // Custom emoji / character chosen by the user.
  return (
    <span
      className={`ag-avatar ag-avatar-custom${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        width: frame,
        height: frame,
        borderRadius: Math.round(frame * 0.32),
        fontSize: Math.round(frame * 0.5),
      }}
    >
      {avatar}
    </span>
  );
}
