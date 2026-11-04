import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentPersona, Note, NoteKind, NoteMeta, RecordDraft } from '../lib/types';
import { KIND_INFO, formatAmount } from '../lib/kinds';
import { AGENT_SUGGESTIONS, agentGreeting, agentReply } from '../lib/agent';
import { groundedAnswer } from '../lib/knowledge';
import type { DailyDigest } from '../lib/digest';
import { MochiNode } from './MochiNode';
import { Icon } from './Icon';
import './AgentPanel.css';

export interface AgentPanelProps {
  persona: AgentPersona;
  notes: Note[];
  onSaveDraft: (draft: RecordDraft) => Promise<void> | void;
  onOpenNote: (id: string) => void;
  /** Opens the persona settings in 我的. */
  onEditPersona: () => void;
  /** Opens the capture sheet. */
  onCreateRecord: () => void;
  /** Today's auto-generated digest, shown as the first assistant module. */
  dailyDigest?: DailyDigest | null;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'bot';
  text: string;
  /** Creation time (epoch ms) shown as the quiet time label above the row. */
  at: number;
  suggestions?: string[];
  /** Set when the agent prepared a record and asks for confirmation. */
  draft?: RecordDraft;
  draftState?: 'pending' | 'saved' | 'cancelled';
  /** Knowledge-base notes cited by the answer. */
  sources?: { id: string; title: string }[];
}

function digestChatMessage(digest: DailyDigest, notes: Note[], id: number): ChatMessage {
  const lines: string[] = [digest.summary];
  for (const section of digest.sections) {
    if (section.highlights.length === 0) continue;
    lines.push('', `【${section.title}】`);
    for (const highlight of section.highlights) lines.push(`· ${highlight}`);
  }
  if (digest.suggestions.length > 0) {
    lines.push('', '今天可以试试：');
    digest.suggestions.forEach((suggestion, index) => lines.push(`${index + 1}. ${suggestion}`));
  }
  const titleById = new Map(notes.map((note) => [note.id, note.title]));
  return {
    id,
    role: 'bot',
    text: lines.join('\n'),
    at: Date.now(),
    sources: digest.sourceIds
      .map((sourceId) => ({ id: sourceId, title: titleById.get(sourceId) ?? '' }))
      .filter((source) => source.title)
      .slice(0, 8),
  };
}

interface Fact {
  label: string;
  value: string;
}

/** 24h clock label for the chat meta line. */
function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Structured one-line facts for a draft, shared by the chat and the card. */
function draftFacts(kind: NoteKind, meta: NoteMeta): Fact[] {
  const facts: Fact[] = [];
  const amount = meta.amount !== undefined ? `¥${formatAmount(meta.amount)}` : '';
  switch (kind) {
    case 'food':
      if (meta.meal && meta.meal !== '未分类') facts.push({ label: '餐次', value: meta.meal });
      if (meta.calories !== undefined) {
        facts.push({ label: '热量', value: `${formatAmount(meta.calories)} 千卡` });
      }
      if (amount) facts.push({ label: '花费', value: amount });
      break;
    case 'health':
      if (meta.metric) facts.push({ label: '指标', value: meta.metric });
      if (meta.value !== undefined) {
        facts.push({
          label: '数值',
          value: `${formatAmount(meta.value)}${meta.unit ? ` ${meta.unit}` : ''}`,
        });
      }
      break;
    case 'finance':
      facts.push({ label: '方向', value: meta.direction === 'income' ? '收入' : '支出' });
      if (amount) facts.push({ label: '金额', value: amount });
      if (meta.category) facts.push({ label: '分类', value: meta.category });
      break;
    default:
      break;
  }
  return facts;
}

/** Render plain reply text line by line; leading "-"/"·" becomes a rule bullet. */
function replyLines(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    if (/^[-·•*]\s+/.test(line)) {
      return (
        <span className="agent-screen__bullet" key={index}>
          {line.replace(/^[-·•*]\s+/, '')}
        </span>
      );
    }
    return (
      <span className="agent-screen__line" key={index}>
        {line}
      </span>
    );
  });
}

/**
 * The built-in local helper, in the 麻薯 chat style: glassy rows on a dark canvas
 * with hairline rules, serif display name and mono meta labels. The greeting
 * comes from `agentGreeting`, replies from `agentReply`, and a prepared record
 * arrives as a bordered confirm table so nothing is saved silently. Messages
 * live in component state only — the panel starts fresh every mount and never
 * touches the network.
 */
export function AgentPanel({
  persona,
  notes,
  onSaveDraft,
  onOpenNote,
  onEditPersona,
  onCreateRecord,
  dailyDigest,
}: AgentPanelProps) {
  const idRef = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const greeting = agentGreeting(notes);
    const initial: ChatMessage[] = [{ id: 0, role: 'bot', text: greeting.text, at: Date.now() }];
    if (dailyDigest) initial.push(digestChatMessage(dailyDigest, notes, idRef.current++));
    return initial;
  });
  const [savingId, setSavingId] = useState<number | null>(null);
  const digestSeenRef = useRef<string | null>(dailyDigest?.dateKey ?? null);

  useEffect(() => {
    if (!dailyDigest || digestSeenRef.current === dailyDigest.dateKey) return;
    digestSeenRef.current = dailyDigest.dateKey;
    setMessages((current) => [...current, digestChatMessage(dailyDigest, notes, idRef.current++)]);
  }, [dailyDigest, notes]);

  const appendBot = useCallback((text: string, suggestions?: string[]) => {
    setMessages((current) => [
      ...current,
      {
        id: idRef.current++,
        role: 'bot',
        text,
        at: Date.now(),
        suggestions: suggestions && suggestions.length > 0 ? [...suggestions] : undefined,
      },
    ]);
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const reply = agentReply(text, notes);
      const grounded =
        reply.action || reply.intent === 'help' || reply.intent === 'capture'
          ? null
          : groundedAnswer(notes, text);
      const answerText = grounded ? grounded.text : reply.text;
      const sources = grounded?.sources;
      const now = Date.now();
      const userMessage: ChatMessage = { id: idRef.current++, role: 'user', text, at: now };
      const botMessage: ChatMessage = {
        id: idRef.current++,
        role: 'bot',
        text: answerText,
        at: now,
        suggestions:
          reply.suggestions && reply.suggestions.length > 0 ? [...reply.suggestions] : undefined,
        draft: reply.action?.type === 'createNote' ? reply.action.draft : undefined,
        draftState: reply.action?.type === 'createNote' ? 'pending' : undefined,
        sources: sources && sources.length > 0 ? sources : undefined,
      };
      setMessages((current) => [...current, userMessage, botMessage]);
      setInput('');
    },
    [notes],
  );

  const saveDraft = useCallback(
    async (message: ChatMessage) => {
      if (!message.draft || message.draftState !== 'pending' || savingId !== null) return;
      setSavingId(message.id);
      try {
        await onSaveDraft(message.draft);
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, draftState: 'saved' as const } : item,
          ),
        );
        appendBot('记好了。');
      } catch {
        appendBot('保存失败，请再试一次。');
      } finally {
        setSavingId(null);
      }
    },
    [appendBot, onSaveDraft, savingId],
  );

  const cancelDraft = useCallback(
    (message: ChatMessage) => {
      if (message.draftState !== 'pending' || savingId !== null) return;
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, draftState: 'cancelled' as const } : item,
        ),
      );
      appendBot('好的，先不记。');
    },
    [appendBot, savingId],
  );

  // Keep the newest message in view. Respect reduced motion for the scroll.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages]);

  const starterSuggestions = useMemo(() => AGENT_SUGGESTIONS.slice(0, 3), []);
  const onlyGreeting = messages.length === 1;

  const handleSend = (): void => {
    send(input);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Never send while an IME composition is active (e.g. pinyin candidate).
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      send(input);
    }
  };

  return (
    <div className="screen agent-screen">
      <header className="agent-screen__header">
        <div className="agent-screen__identity">
          <MochiNode size={26} />
          <div className="agent-screen__title-block">
            <h1 className="agent-screen__name">{persona.name}</h1>
            <p className="agent-screen__subtitle">本地处理 · 仅你可见</p>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn agent-screen__edit"
          aria-label="更换头像和名字"
          title="更换头像和名字"
          onClick={onEditPersona}
        >
          <Icon name="edit" size={18} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="agent-screen__scroll scroll-area"
        role="log"
        aria-live="polite"
        aria-label={`与${persona.name}的对话`}
      >
        {messages.map((message, index) => (
          <div className={`agent-screen__row agent-screen__row--${message.role}`} key={message.id}>
            <p className={`agent-screen__meta agent-screen__meta--${message.role}`}>
              {clock(message.at)}
            </p>
            <div className="agent-screen__body">
              {message.role === 'user' ? (
                <div className="agent-screen__user-block">
                  <p className="agent-screen__text">{replyLines(message.text)}</p>
                </div>
              ) : (
                <>
                  <p className="agent-screen__text">{replyLines(message.text)}</p>

                  {message.sources && message.sources.length > 0 ? (
                    <div className="agent-screen__sources">
                      {message.sources.map((source) => (
                        <button
                          key={source.id}
                          type="button"
                          className="agent-screen__source"
                          onClick={() => onOpenNote(source.id)}
                          title="打开这条记录"
                        >
                          《{source.title}》
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {message.draft && message.draftState ? (
                    <div className={`agent-screen__draft is-${message.draftState}`}>
                      <div className="agent-screen__draft-head">
                        <span
                          className="agent-screen__draft-kind"
                          style={{ color: `var(${KIND_INFO[message.draft.kind].accentVar})` }}
                        >
                          {KIND_INFO[message.draft.kind].label}
                        </span>
                        <span className="agent-screen__draft-state">
                          {message.draftState === 'pending'
                            ? '待确认'
                            : message.draftState === 'saved'
                              ? '已保存'
                              : '已取消'}
                        </span>
                      </div>
                      <p className="agent-screen__draft-title">{message.draft.title}</p>
                      {draftFacts(message.draft.kind, message.draft.meta).length > 0 ? (
                        <dl className="agent-screen__draft-facts">
                          {draftFacts(message.draft.kind, message.draft.meta).map((fact) => (
                            <div
                              className="agent-screen__draft-fact"
                              key={`${fact.label}-${fact.value}`}
                            >
                              <dt>{fact.label}</dt>
                              <dd>{fact.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {message.draftState === 'pending' ? (
                        <div className="agent-screen__draft-actions">
                          <button
                            type="button"
                            className="agent-screen__draft-btn agent-screen__draft-btn--save"
                            disabled={savingId !== null}
                            onClick={() => void saveDraft(message)}
                          >
                            {savingId === message.id ? '保存中…' : '保存'}
                          </button>
                          <button
                            type="button"
                            className="agent-screen__draft-btn agent-screen__draft-btn--cancel"
                            disabled={savingId !== null}
                            onClick={() => cancelDraft(message)}
                          >
                            取消
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {message.suggestions && message.suggestions.length > 0 && index === messages.length - 1 ? (
                    <div className="agent-screen__suggestions" role="group" aria-label="继续提问">
                      {message.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="agent-screen__suggestion"
                          onClick={() => send(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="agent-screen__composer-wrap">
        {onlyGreeting && starterSuggestions.length > 0 ? (
          <div className="agent-screen__suggestions agent-screen__starters" role="group" aria-label="可以这样问">
            {starterSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="agent-screen__suggestion"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="agent-screen__composer"
          onSubmit={(event) => {
            event.preventDefault();
            handleSend();
          }}
        >
          <button
            type="button"
            className="agent-screen__action"
            aria-label="打开记一笔"
            title="记一笔"
            onClick={onCreateRecord}
          >
            <Icon name="plus" size={18} />
          </button>
          <input
            ref={inputRef}
            className="agent-screen__input"
            type="text"
            value={input}
            placeholder={`问${persona.name}，或记一笔`}
            aria-label="输入消息"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button
            type="submit"
            className="agent-screen__action agent-screen__send"
            aria-label="发送"
            title="发送"
            disabled={input.trim().length === 0}
          >
            <Icon name="arrowRight" size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
