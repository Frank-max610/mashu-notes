export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill a faint area under the line. */
  area?: boolean;
}

/** Minimal sparkline for the dashboard metric cards. */
export function Sparkline({ values, width = 64, height = 20, color = 'var(--accent)', area = false }: SparklineProps) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {area ? (
        <polygon points={`0,${height} ${line} ${width},${height}`} fill={color} opacity="0.08" />
      ) : null}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
