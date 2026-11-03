import { useMemo } from 'react';
import type { Note } from '../lib/types';
import { backlinksFor, outgoingLinks } from '../lib/links';
import { Icon } from './Icon';
import './BacklinksPanel.css';

export interface BacklinksPanelProps {
  note: Note;
  notes: Note[];
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}

/**
 * Compact link footer for the editor: outgoing [[wiki links]] (with a
 * "create" action for dangling targets) and incoming backlinks.
 * Renders nothing when the note is not connected either way.
 */
export function BacklinksPanel({ note, notes, onOpenNote, onCreateNote }: BacklinksPanelProps) {
  const outgoing = useMemo(() => outgoingLinks(note, notes), [note, notes]);
  const backlinks = useMemo(() => backlinksFor(note, notes), [note, notes]);

  if (outgoing.length === 0 && backlinks.length === 0) return null;

  return (
    <section className="backlinks-panel" aria-label="链接关系">
      {outgoing.length > 0 ? (
        <div className="backlinks-panel__section">
          <div className="section-label backlinks-panel__heading">
            <Icon name="flower" size={13} />
            <span>串起来的麻薯</span>
            <span className="badge">{outgoing.length}</span>
          </div>
          <div className="backlinks-panel__list">
            {outgoing.map((link) => {
              const resolved = link.note;
              if (resolved) {
                return (
                  <button
                    key={link.target}
                    type="button"
                    className="backlinks-panel__link is-resolved"
                    onClick={() => onOpenNote(resolved.id)}
                  >
                    <Icon name="link" size={13} />
                    <span className="backlinks-panel__label">{link.alias || resolved.title}</span>
                  </button>
                );
              }
              return (
                <button
                  key={link.target}
                  type="button"
                  className="backlinks-panel__link is-missing"
                  title={`创建「${link.target}」`}
                  onClick={() => onCreateNote(link.target)}
                >
                  <Icon name="sparkles" size={13} />
                  <span className="backlinks-panel__label">{link.target}</span>
                  <span className="backlinks-panel__missing">还没捏</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {backlinks.length > 0 ? (
        <div className="backlinks-panel__section">
          <div className="section-label backlinks-panel__heading">
            <Icon name="heart" size={13} />
            <span>被这些麻薯串到</span>
            <span className="badge">{backlinks.length}</span>
          </div>
          <div className="backlinks-panel__list">
            {backlinks.map((backlink) => (
              <button
                key={backlink.note.id}
                type="button"
                className="backlinks-panel__link is-backlink"
                onClick={() => onOpenNote(backlink.note.id)}
              >
                <Icon name="heart" size={13} />
                <span className="backlinks-panel__label">
                  {backlink.note.title || '未命名笔记'}
                </span>
                <span className="badge">{backlink.count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
