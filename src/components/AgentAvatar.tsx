import type { CSSProperties, ReactNode } from 'react';
import { AGENT_AVATARS } from '../lib/prefs';

export interface AgentAvatarProps {
  /** Preset id from `AGENT_AVATARS` (seal/initial/ring/...) or a custom emoji/text. */
  avatar: string;
  /** Frame edge length in px. Defaults to 44. */
  size?: number;
  className?: string;
  /** Persona name used by the `initial` sigil (falls back to 日). */
  name?: string;
}

const PRESET_IDS = new Set(AGENT_AVATARS.map((option) => option.id));

/** Non-seal sigils invert to cream-on-ink once they are large display marks. */
const INVERT_FROM = 52;
const INK_FRAME_INVERT = new Set(['initial', 'ring', 'square', 'triad', 'spark', 'wave', 'grid']);

/** Keep every sigil stroke a 1.5px hairline at any rendered size. */
function hairline(size: number): number {
  return (1.5 * 24) / size;
}

/** First visible character of the persona name, surrogate-pair aware. */
function initialOf(name: string | undefined): string {
  const first = Array.from((name ?? '').trim())[0];
  return first ?? '日';
}

interface SigilProps {
  preset: string;
  size: number;
}

/** Inline geometric sigils, drawn on a 24px grid with square joins. */
function Sigil({ preset, size }: SigilProps) {
  const stroke = hairline(size);
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
  };

  switch (preset) {
    case 'ring':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.25" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'square':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="15" height="15" />
          <rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'triad':
      return (
        <svg {...common}>
          <path d="M12 4.8 19.4 19H4.6Z" />
          <circle cx="12" cy="4.8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="19.4" cy="19" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="4.6" cy="19" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3.4v17.2M3.4 12h17.2M6 6l12 12M18 6 6 18" />
          <rect
            x="10.9"
            y="10.9"
            width="2.2"
            height="2.2"
            transform="rotate(45 12 12)"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case 'wave':
      return (
        <svg {...common}>
          <path d="M3 9.2c3-3.1 6 3.1 9 0s6-3.1 9 0" />
          <path d="M3 14.8c3-3.1 6 3.1 9 0s6-3.1 9 0" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" />
          <path d="M9.34 4v16M14.66 4v16M4 9.34h16M4 14.66h16" />
          <rect x="9.34" y="9.34" width="5.32" height="5.32" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * The local agent's avatar: abstract ink sigils for the preset ids, or a
 * user-entered emoji/text rendered in a neutral frame. Purely decorative —
 * callers provide the accessible name (e.g. around the persona header).
 */
export function AgentAvatar({ avatar, size = 44, className, name }: AgentAvatarProps) {
  const value = avatar.trim();
  const preset = PRESET_IDS.has(value) ? value : null;
  const inverted = preset !== null && INK_FRAME_INVERT.has(preset) && size >= INVERT_FROM;

  const frame: CSSProperties = {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: preset === 'ring' ? '50%' : '5px',
    border: '1px solid var(--border-strong)',
    background: inverted ? 'var(--text)' : 'var(--surface)',
    color: inverted ? 'var(--bg)' : 'var(--text)',
  };

  if (preset === 'seal') {
    frame.background = 'var(--accent)';
    frame.borderColor = 'var(--accent-strong)';
    frame.color = 'var(--accent-contrast)';
  }

  let content: ReactNode;
  if (preset === 'seal') {
    content = (
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: Math.round(size * 0.3),
          lineHeight: 0.98,
          letterSpacing: '0.02em',
          fontWeight: 600,
        }}
      >
        <span>日</span>
        <span>新</span>
      </span>
    );
  } else if (preset === 'initial') {
    content = (
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: Math.round(size * 0.46),
          lineHeight: 1,
          fontWeight: 600,
        }}
      >
        {initialOf(name)}
      </span>
    );
  } else if (preset) {
    content = <Sigil preset={preset} size={Math.round(size * 0.56)} />;
  } else {
    const glyphs = Array.from(value);
    const glyph = glyphs[0] ?? '日';
    const fontSize =
      glyphs.length <= 2 ? Math.round(size * 0.44) : glyphs.length <= 4 ? Math.round(size * 0.28) : Math.round(size * 0.2);
    content = (
      <span
        aria-hidden="true"
        style={{
          maxWidth: '90%',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontFamily: 'var(--font-display)',
          fontSize,
          lineHeight: 1.1,
        }}
      >
        {glyphs.length > 1 ? value : glyph}
      </span>
    );
  }

  return (
    <span
      className={`agent-avatar${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      data-sigil={preset ?? 'custom'}
      style={frame}
    >
      {content}
    </span>
  );
}
