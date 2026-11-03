import type { SVGProps } from 'react';

export type MascotVariant = 'happy' | 'wink' | 'sleepy' | 'love';

export interface MascotProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  variant?: MascotVariant;
  size?: number;
  /** Slight idle bob animation. */
  bob?: boolean;
}

/**
 * Mochi the mascot: a squishy strawberry-milk dumpling with a tiny strawberry
 * hat. Pure inline SVG so it works offline and inherits the pastel palette.
 */
export function Mascot({ variant = 'happy', size = 88, bob = false, className, ...rest }: MascotProps) {
  const id = `mochi-${variant}`;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="麻薯吉祥物"
      className={`mochi-mascot${bob ? ' is-bobbing' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#FFF1F5" />
          <stop offset="52%" stopColor="#FFD9E4" />
          <stop offset="100%" stopColor="#FFC2D4" />
        </linearGradient>
        <radialGradient id={`${id}-cheek`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF9DB4" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FF9DB4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-berry`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#FF8FAB" />
          <stop offset="100%" stopColor="#E8557B" />
        </linearGradient>
      </defs>

      {/* puddle shadow */}
      <ellipse cx="60" cy="106" rx="34" ry="6" fill="#E8557B" opacity="0.12" />

      {/* squishy body */}
      <path
        d="M60 16c22.5 0 38 14.2 38 37.4 0 26.2-16.6 45.6-38 45.6S22 79.6 22 53.4C22 30.2 37.5 16 60 16Z"
        fill={`url(#${id}-body)`}
      />
      <path
        d="M35 37c3.6-7.8 12-12.6 21.6-13.4"
        stroke="#FFFFFF"
        strokeOpacity="0.9"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />

      {/* strawberry hat */}
      <path d="M93 9c-2 5 1 9 7 9 7 0 10-6 8-11-4 2-9 3-15 2Z" fill="#7FCB9A" />
      <path
        d="M84 31c-1-9 5-17 14-17s15 8 14 17c-2 7-10 11-14 11s-12-4-14-11Z"
        fill={`url(#${id}-berry)`}
      />
      <circle cx="94" cy="22" r="1.4" fill="#FFE6EC" opacity="0.9" />
      <circle cx="101" cy="26" r="1.2" fill="#FFE6EC" opacity="0.8" />
      <circle cx="98" cy="31" r="1.1" fill="#FFE6EC" opacity="0.7" />

      {/* cheeks */}
      <ellipse cx="38" cy="63" rx="10" ry="6.4" fill={`url(#${id}-cheek)`} />
      <ellipse cx="82" cy="63" rx="10" ry="6.4" fill={`url(#${id}-cheek)`} />

      {/* eyes + mouth per mood */}
      {variant === 'happy' ? (
        <>
          <circle cx="48" cy="54" r="3.6" fill="#5A3B46" />
          <circle cx="72" cy="54" r="3.6" fill="#5A3B46" />
          <circle cx="49.2" cy="52.8" r="1.1" fill="#FFFFFF" />
          <circle cx="73.2" cy="52.8" r="1.1" fill="#FFFFFF" />
          <path d="M56 63c1.6 2.4 6.4 2.4 8 0" stroke="#5A3B46" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {variant === 'wink' ? (
        <>
          <circle cx="48" cy="54" r="3.6" fill="#5A3B46" />
          <circle cx="49.2" cy="52.8" r="1.1" fill="#FFFFFF" />
          <path d="M66 54c2.4-2.8 7.2-2.8 9.6 0" stroke="#5A3B46" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M56 63c1.6 2.4 6.4 2.4 8 0" stroke="#5A3B46" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {variant === 'sleepy' ? (
        <>
          <path d="M44 55c2.2-2.6 6.2-2.6 8.4 0" stroke="#5A3B46" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M67.6 55c2.2-2.6 6.2-2.6 8.4 0" stroke="#5A3B46" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <ellipse cx="60" cy="64" rx="3" ry="2.2" fill="#5A3B46" />
          <text x="97" y="52" fontSize="13" fill="#B79CED" fontFamily="ui-rounded, system-ui">
            z
          </text>
        </>
      ) : null}
      {variant === 'love' ? (
        <>
          <path
            d="M48 51.4c0-2.6 3.4-3.8 5-1.8 1.6-2 5-0.8 5 1.8 0 3-5 6-5 6s-5-3-5-6Z"
            fill="#E8557B"
          />
          <path
            d="M67 51.4c0-2.6 3.4-3.8 5-1.8 1.6-2 5-0.8 5 1.8 0 3-5 6-5 6s-5-3-5-6Z"
            fill="#E8557B"
          />
          <path d="M55 64c1.8 2.8 8.2 2.8 10 0" stroke="#5A3B46" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}

      {/* tiny arms */}
      <path d="M25 66c-3.6 1.4-5.4 4.4-4.6 7.4" stroke="#F3B7C8" strokeWidth="4.6" strokeLinecap="round" fill="none" />
      <path d="M95 66c3.6 1.4 5.4 4.4 4.6 7.4" stroke="#F3B7C8" strokeWidth="4.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The small brand mark used in headers and the favicon-ish spots. */
export function MochiMark({ size = 40 }: { size?: number }) {
  return <Mascot variant="happy" size={size} bob={false} aria-hidden="true" />;
}
