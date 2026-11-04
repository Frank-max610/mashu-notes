import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { directoryColor, directoryList, notesInDirectory } from '../lib/directories';
import { Icon } from './Icon';

export interface GraphTeaserProps {
  notes: Note[];
  onOpenGraph: () => void;
  onOpenDirectories: () => void;
}

/** The life graph is the product's front door, not a hidden utility. */
export function GraphTeaser({ notes, onOpenGraph, onOpenDirectories }: GraphTeaserProps) {
  const directories = useMemo(() => directoryList(notes).slice(0, 3), [notes]);
  const counts = useMemo(
    () => directories.map((directory) => notesInDirectory(notes, directory.id).length),
    [directories, notes],
  );
  const memberTotal = counts.reduce((sum, count) => sum + count, 0);
  const hasDirs = directories.length > 0;
  const hubs = hasDirs
    ? directories.map((directory, index) => ({
        color: directoryColor(directory),
        label: directory.title,
        count: counts[index],
        x: [92, 232, 162][index] ?? 162,
        y: [66, 74, 166][index] ?? 120,
        members: Math.min(7, Math.max(1, Math.ceil(counts[index] / 2))),
      }))
    : [];

  return (
    <section className="graph-teaser" aria-label="生活图谱">
      <button type="button" className="graph-teaser-main" onClick={onOpenGraph}>
        <div className="graph-teaser-canvas" aria-hidden="true">
          <svg viewBox="0 0 320 210" preserveAspectRatio="xMidYMid meet">
            <defs>
              <radialGradient id="graphGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.10" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="162" cy="118" r="104" fill="url(#graphGlow)" />
            {hasDirs ? (
              <>
                {hubs.map((hub, hubIndex) => (
                  <g key={`${hub.label}-${hubIndex}`}>
                    <line x1="162" y1="118" x2={hub.x} y2={hub.y} className="graph-teaser-link" />
                    {Array.from({ length: hub.members }, (_, memberIndex) => {
                      const angle = (Math.PI * 2 * memberIndex) / hub.members + hubIndex;
                      const distance = 50 + (memberIndex % 3) * 13;
                      const mx = hub.x + Math.cos(angle) * distance;
                      const my = hub.y + Math.sin(angle) * distance;
                      return (
                        <g key={memberIndex}>
                          <line x1={hub.x} y1={hub.y} x2={mx} y2={my} className="graph-teaser-branch" />
                          <circle cx={mx} cy={my} r={3.4} fill={hub.color} opacity="0.75" />
                        </g>
                      );
                    })}
                    <circle cx={hub.x} cy={hub.y} r="15" fill={hub.color} opacity="0.18" />
                    <circle cx={hub.x} cy={hub.y} r="9" fill={hub.color} />
                    <text x={hub.x} y={hub.y + 28} className="graph-teaser-label">{hub.label}</text>
                  </g>
                ))}
                <circle cx="162" cy="118" r="8" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />
              </>
            ) : (
              <>
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const angle = (Math.PI * 2 * index) / 6 - Math.PI / 3;
                  const x = 162 + Math.cos(angle) * 66;
                  const y = 112 + Math.sin(angle) * 48;
                  return (
                    <g key={index}>
                      <line x1="162" y1="112" x2={x} y2={y} className="graph-teaser-branch" />
                      <circle cx={x} cy={y} r={5} fill="var(--text-faint)" opacity="0.55" />
                    </g>
                  );
                })}
                <circle cx="162" cy="112" r="10" fill="var(--accent)" opacity="0.18" />
                <circle cx="162" cy="112" r="5.5" fill="var(--accent)" />
              </>
            )}
          </svg>
        </div>
        <div className="graph-teaser-copy">
          <span className="graph-teaser-eyebrow">生活图谱</span>
          <span className="graph-teaser-title">
            {hasDirs ? `${directories.length} 个目录，${memberTotal} 条记录连在一起` : '你的生活，正在长成一张图'}
          </span>
          <span className="graph-teaser-hint">
            {hasDirs ? '点开看看它们的关系' : '建一个目录，图谱就从这里长出来'}
          </span>
          <span className="graph-teaser-cta">
            打开图谱 <Icon name="arrowRight" size={14} />
          </span>
        </div>
      </button>
      <div className="graph-teaser-foot">
        <span>记录、目录、关系，都在一张图里</span>
        {!hasDirs ? (
          <button type="button" className="graph-teaser-build" onClick={onOpenDirectories}>
            先建目录
          </button>
        ) : (
          <span className="mono">{notes.length} 条记录</span>
        )}
      </div>
    </section>
  );
}
