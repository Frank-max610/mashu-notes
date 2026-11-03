import { useMemo } from 'react';

const SPARKS = ['♡', '🌸', '🍡', '✧', '🍓', '♡', '☁️', '✿'];

export interface HeartBurstProps {
  /** Increment this to replay the animation (0 = idle). */
  burstKey: number;
}

/**
 * Tiny celebration when a note is created: hearts and strawberries float up
 * from the new-note button. Purely decorative; removed automatically.
 */
export function HeartBurst({ burstKey }: HeartBurstProps) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        char: SPARKS[index % SPARKS.length],
        left: 6 + ((index * 37) % 88),
        delay: (index % 5) * 40,
        drift: (index % 2 === 0 ? 1 : -1) * (10 + ((index * 13) % 30)),
        size: 14 + ((index * 7) % 12),
      })),
    [burstKey],
  );

  if (!burstKey) return null;

  return (
    <div className="heart-burst" aria-hidden="true" key={burstKey}>
      {pieces.map((piece, index) => (
        <span
          key={`${burstKey}-${index}`}
          className="heart-burst__piece"
          style={{
            left: `${piece.left}%`,
            fontSize: `${piece.size}px`,
            animationDelay: `${piece.delay}ms`,
            ['--drift' as string]: `${piece.drift}px`,
          }}
        >
          {piece.char}
        </span>
      ))}
    </div>
  );
}
