import type { ReactNode } from 'react';
import { MochiNode } from './MochiNode';

export interface AgentAvatarProps {
  avatar: string;
  size?: number;
  className?: string;
  /** Kept for API compatibility. */
  name?: string;
}

const PRESETS = new Set(['node', 'orbit', 'ring', 'square', 'triad', 'spark', 'wave', 'grid']);

const GLYPHS: Record<string, ReactNode> = {
  ring: <circle cx="14" cy="14" r="6.5" />,
  square: <rect x="8" y="8" width="12" height="12" rx="2" />,
  triad: (
    <g>
      <circle cx="14" cy="8" r="2.2" />
      <circle cx="8.5" cy="18" r="2.2" />
      <circle cx="19.5" cy="18" r="2.2" />
      <path d="M14 8 8.5 18h11z" strokeOpacity=".45" />
    </g>
  ),
  spark: <path d="M14 5v18M5 14h18M8.5 8.5l11 11M19.5 8.5l-11 11" />,
  wave: <path d="M5 17c3-4 6-4 9 0s6 4 9 0M5 10c3-4 6-4 9 0s6 4 9 0" />,
  grid: <path d="M9 5v18M19 5v18M5 9h18M5 19h18" />,
  orbit: (
    <g>
      <circle cx="14" cy="14" r="3.2" fill="currentColor" stroke="none" />
      <ellipse cx="14" cy="14" rx="10" ry="5.5" transform="rotate(-28 14 14)" />
      <ellipse cx="14" cy="14" rx="5.5" ry="10" transform="rotate(28 14 14)" />
    </g>
  ),
};

/** Abstract node avatars for the local helper; custom characters still render. */
export function AgentAvatar({ avatar, size = 40, className }: AgentAvatarProps) {
  const frame = Math.max(22, size);
  if (!PRESETS.has(avatar)) {
    return (
      <span
        className={`ag-avatar ag-avatar-custom${className ? ` ${className}` : ''}`}
        aria-hidden="true"
        style={{ width: frame, height: frame, fontSize: Math.round(frame * 0.48) }}
      >
        {avatar}
      </span>
    );
  }

  if (avatar === 'node') {
    return (
      <span
        className={`ag-avatar ag-avatar-node${className ? ` ${className}` : ''}`}
        aria-hidden="true"
        style={{ width: frame, height: frame }}
      >
        <MochiNode size={Math.round(frame * 0.92)} breath={false} />
      </span>
    );
  }

  return (
    <span
      className={`ag-avatar ag-avatar-glyph${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{ width: frame, height: frame, borderRadius: Math.round(frame * 0.26) }}
    >
      <svg
        viewBox="0 0 28 28"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[avatar]}
      </svg>
    </span>
  );
}
