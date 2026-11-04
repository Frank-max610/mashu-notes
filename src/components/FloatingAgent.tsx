import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentPersona } from '../lib/types';
import { AgentAvatar } from './AgentAvatar';
import './FloatingAgent.css';

export interface FloatingAgentProps {
  persona: AgentPersona;
  /** Tap: record something right away. */
  onCapture: () => void;
  /** Long press: open the conversational assistant. */
  onOpenAgent: () => void;
}

interface Position {
  x: number;
  y: number;
}

const POSITION_KEY = 'mashu.floatagent.v1';
const BUBBLE = 60;

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Position>;
    if (typeof value.x !== 'number' || typeof value.y !== 'number') return null;
    return { x: value.x, y: value.y };
  } catch {
    return null;
  }
}

function clampPosition(x: number, y: number): Position {
  const margin = 8;
  return {
    x: Math.min(Math.max(margin, x), window.innerWidth - BUBBLE - margin),
    y: Math.min(Math.max(margin + 8, y), window.innerHeight - BUBBLE - margin),
  };
}

/** The floating local agent: draggable, always one tap from recording. */
export function FloatingAgent({ persona, onCapture, onOpenAgent }: FloatingAgentProps) {
  const [position, setPosition] = useState<Position | null>(() => loadPosition());
  const startRef = useRef<{ x: number; y: number; pos: Position; moved: boolean } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const longFiredRef = useRef(false);
  const movedRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  useEffect(() => {
    const onResize = () => {
      if (position) setPosition(clampPosition(position.x, position.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const persist = (next: Position) => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      className="floating-agent"
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      aria-label={`${persona.name}：点一下记一笔，长按打开对话`}
      title={`${persona.name}：点一下记一笔，长按聊天`}
      onPointerDown={(event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = {
          x: event.clientX,
          y: event.clientY,
          pos: position ?? {
            x: window.innerWidth - BUBBLE - 16,
            y: window.innerHeight - BUBBLE - 110,
          },
          moved: false,
        };
        movedRef.current = false;
        longFiredRef.current = false;
        clearLongPress();
        longPressRef.current = window.setTimeout(() => {
          if (!movedRef.current) {
            longFiredRef.current = true;
            onOpenAgent();
          }
        }, 650);
      }}
      onPointerMove={(event) => {
        const start = startRef.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!movedRef.current && Math.hypot(dx, dy) < 6) return;
        movedRef.current = true;
        clearLongPress();
        setPosition(clampPosition(start.pos.x + dx, start.pos.y + dy));
      }}
      onPointerUp={(event) => {
        const start = startRef.current;
        startRef.current = null;
        clearLongPress();
        if (start && movedRef.current) {
          const next = clampPosition(
            start.pos.x + (event.clientX - start.x),
            start.pos.y + (event.clientY - start.y),
          );
          setPosition(next);
          persist(next);
          return;
        }
        if (!longFiredRef.current) onCapture();
      }}
      onPointerCancel={() => {
        startRef.current = null;
        clearLongPress();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCapture();
        }
      }}
    >
      <span className="floating-agent-ring" aria-hidden="true" />
      <AgentAvatar avatar={persona.avatar} name={persona.name} size={48} />
      <span className="floating-agent-plus" aria-hidden="true">+</span>
      <span className="floating-agent-dot" aria-hidden="true" />
    </button>
  );
}
