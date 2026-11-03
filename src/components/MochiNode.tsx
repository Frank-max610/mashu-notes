export interface MochiNodeProps {
  size?: number;
  className?: string;
  /** Animate the slow brand breath (disabled for reduced motion via CSS). */
  breath?: boolean;
}

/**
 * Mochi Node — the product's brand mark and centre of the life graph:
 * one warm dot with two or three smaller associated nodes on thin orbits.
 * No mascot, no face, no fruit. Used once per screen.
 */
export function MochiNode({ size = 28, className, breath = true }: MochiNodeProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="麻薯"
      className={`mochi-node${breath ? ' is-breathing' : ''}${className ? ` ${className}` : ''}`}
    >
      <g stroke="var(--text-muted)" strokeOpacity="0.38" strokeWidth="1.4" fill="none">
        <ellipse cx="32" cy="32" rx="22" ry="14" transform="rotate(-24 32 32)" />
        <ellipse cx="32" cy="32" rx="15" ry="22" transform="rotate(32 32 32)" />
      </g>
      <circle cx="32" cy="32" r="9.5" fill="var(--accent)" />
      <circle cx="32" cy="32" r="9.5" fill="none" stroke="var(--surface)" strokeWidth="1.2" strokeOpacity="0.55" />
      <circle cx="51" cy="24" r="3.4" fill="var(--kind-diary)" />
      <circle cx="17" cy="43" r="3" fill="var(--kind-health)" />
      <circle cx="45" cy="49" r="2.6" fill="var(--kind-finance)" />
      <circle cx="14" cy="21" r="2" fill="var(--kind-food)" opacity="0.85" />
    </svg>
  );
}
