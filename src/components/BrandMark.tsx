export interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** 麻薯 brand mark: a warm gradient squircle with a cream 麻 character. */
export function BrandMark({ size = 30, className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="麻薯"
      className={`brand-mark${className ? ` ${className}` : ''}`}
    >
      <defs>
        <linearGradient id="mashu-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a17" />
          <stop offset="0.5" stopColor="#ff4d8d" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id="mashu-gloss" cx="0.3" cy="0.22" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="19" fill="url(#mashu-brand)" />
      <rect width="64" height="64" rx="19" fill="url(#mashu-gloss)" />
      <text
        x="32"
        y="45"
        textAnchor="middle"
        fontFamily="-apple-system, 'PingFang SC', 'SF Pro Display', sans-serif"
        fontSize="36"
        fontWeight="800"
        fill="#fff7f2"
      >
        麻
      </text>
    </svg>
  );
}
