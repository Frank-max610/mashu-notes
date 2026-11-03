import { AGENT_AVATARS } from '../lib/prefs';
import { Mascot } from './Mascot';

export interface AgentAvatarProps {
  /** Preset id from `AGENT_AVATARS` (`mochi`, `cat`, ...) or a custom emoji. */
  avatar: string;
  /** Diameter of the circle in px. Defaults to 44. */
  size?: number;
  className?: string;
}

/**
 * The user-chosen agent avatar.
 *
 * Preset ids render their matching emoji; the special `mochi` preset renders
 * the app mascot. Anything that is not a preset id is treated as a custom
 * emoji string, so multi-codepoint emoji and short text both work. Everything
 * sits in a soft neutral circle so the mascot and an emoji read as the same
 * visual size. Purely decorative: callers supply their own accessible label.
 */
export function AgentAvatar({ avatar, size = 44, className }: AgentAvatarProps) {
  const preset = AGENT_AVATARS.find((option) => option.id === avatar);
  const custom = avatar.trim();

  return (
    <span
      className={`agent-avatar${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        flex: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        overflow: 'hidden',
        borderRadius: '50%',
        background: 'var(--surface-2)',
        border: '1.5px solid var(--border)',
        boxShadow: 'var(--shadow-1)',
        fontSize: Math.round(size * 0.46),
        lineHeight: 1,
      }}
    >
      {avatar === 'mochi' ? (
        <Mascot variant="happy" size={Math.round(size * 0.86)} aria-hidden="true" />
      ) : (
        <span className="agent-avatar__glyph">{preset?.emoji ?? (custom || '🍡')}</span>
      )}
    </span>
  );
}
