export interface BrandSealProps {
  size?: number;
  className?: string;
  /** Show the seal only (no wordmark). */
  title?: string;
}

/** 日新 seal mark: vermilion stamp with cream Songti characters. */
export function BrandSeal({ size = 32, className, title = '日新' }: BrandSealProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={`brand-seal${className ? ` ${className}` : ''}`}
    >
      <rect width="64" height="64" fill="var(--accent-strong)" />
      <rect x="5.5" y="5.5" width="53" height="53" fill="none" stroke="var(--accent-contrast)" strokeOpacity=".8" />
      <text
        x="32"
        y="43"
        textAnchor="middle"
        fontFamily="Songti SC, Noto Serif SC, STSong, serif"
        fontSize="30"
        fontWeight="600"
        fill="var(--accent-contrast)"
      >
        日新
      </text>
    </svg>
  );
}
