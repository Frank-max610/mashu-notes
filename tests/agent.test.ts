import { describe, expect, it } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import {
  AGENT_SUGGESTIONS,
  agentGreeting,
  agentReply,
  captureDraft,
  parseEntry,
  type AgentReply,
} from '../src/lib/agent';

let counter = 0;

interface NoteInput {
  title?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  ts?: number;
}

function makeNote(input: NoteInput): Note {
  counter += 1;
  const ts = input.ts ?? new Date(2026, 2, 10, 12, 0).getTime();
  const meta: NoteMeta = { ...input.meta };
  if (meta.occurredAt === undefined) meta.occurredAt = ts;
  return {
    id: `note-${counter}`,
    title: input.title ?? '记录',
    content: '',
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    pinned: false,
    kind: input.kind ?? 'note',
    meta,
    manualLinks: [],
  };
}

/** Fixed "now": 2026-03-10 12:30 local time. */
const NOW = new Date(2026, 2, 10, 12, 30);

function at(hour: number, minute = 0): number {
  return new Date(2026, 2, 10, hour, minute).getTime();
}

const VAULT: Note[] = [
  makeNote({ kind: 'food', title: '早餐', meta: { meal: '早餐', amount: 8, calories: 480 }, ts: at(8) }),
  makeNote({ kind: 'food', title: '午餐', meta: { meal: '午餐', amount: 32, calories: 620 }, ts: at(12) }),
  makeNote({ kind: 'finance', title: '咖啡', meta: { amount: 18, category: '餐饮', direction: 'expense' }, ts: at(15) }),
  makeNote({ kind: 'finance', title: '工资', meta: { amount: 8500, category: '收入', direction: 'income' }, ts: at(9) }),
  makeNote({ kind: 'health', title: '睡眠', meta: { metric: '睡眠', value: 7.2, unit: '小时' }, ts: at(7) }),
  makeNote({ kind: 'health', title: '体重', meta: { metric: '体重', value: 52.4, unit: 'kg' }, ts: at(7) }),
  makeNote({ kind: 'health', title: '步数', meta: { metric: '步数', value: 8321, unit: '步' }, ts: at(19) }),
  makeNote({ kind: 'health', title: '饮水', meta: { metric: '饮水', value: 750, unit: 'ml' }, ts: at(16) }),
  makeNote({ kind: 'health', title: '心情', meta: { metric: '心情', mood: '平静' }, ts: at(17) }),
  makeNote({ kind: 'diary', title: '日记', ts: at(21) }),
];

describe('parseEntry — food', () => {
  it('parses a meal with amount, calories, dishes and meal slot', () => {
    const draft = parseEntry('午饭牛肉面 32 元 620 千卡', NOW);

    expect(draft).not.toBeNull();
    expect(draft?.kind).toBe('food');
    expect(draft?.meta.meal).toBe('午餐');
    expect(draft?.meta.amount).toBe(32);
    expect(draft?.meta.calories).toBe(620);
    expect(draft?.meta.dishes).toContain('牛肉面');
    expect(draft?.title).toContain('午餐');
    expect(draft?.title).toContain('牛肉面');
    expect(draft?.content).toContain('#饮食');
    expect(draft?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('falls back to the hour when no meal keyword is present', () => {
    expect(parseEntry('咖啡 18 元', new Date(2026, 2, 10, 9, 0))?.meta.meal).toBe('早餐');
    expect(parseEntry('咖啡 18 元', new Date(2026, 2, 10, 13, 0))?.meta.meal).toBe('午餐');
    expect(parseEntry('咖啡 18 元', new Date(2026, 2, 10, 19, 0))?.meta.meal).toBe('晚餐');
    expect(parseEntry('咖啡 18 元', new Date(2026, 2, 10, 21, 0))?.meta.meal).toBe('夜宵');
  });

  it('uses explicit meal keywords without a price', () => {
    const draft = parseEntry('晚饭吃了番茄鸡蛋面', NOW);
    expect(draft?.kind).toBe('food');
    expect(draft?.meta.meal).toBe('晚餐');
    expect(draft?.meta.amount).toBeUndefined();
    expect(draft?.meta.dishes).toContain('番茄鸡蛋面');
    expect(draft?.title).toBe('晚餐 · 番茄鸡蛋面');
  });
});

describe('parseEntry — finance', () => {
  it('parses an expense with a category', () => {
    const draft = parseEntry('打车 30 元', NOW);
    expect(draft?.kind).toBe('finance');
    expect(draft?.meta.amount).toBe(30);
    expect(draft?.meta.category).toBe('交通');
    expect(draft?.meta.direction).toBe('expense');
    expect(draft?.title).toContain('¥30');
    expect(draft?.content).toContain('#理财');
  });

  it('maps common expense keywords to categories', () => {
    const cases: [string, string][] = [
      ['外卖 25 元', '餐饮'],
      ['买衣服 299 元', '购物'],
      ['房租 3000 元', '居住'],
      ['电影 45 元', '娱乐'],
      ['买药 30 元', '医疗'],
      ['买书 50 元', '学习'],
      ['红包 200 元', '人情'],
    ];
    for (const [text, category] of cases) {
      expect(parseEntry(text, NOW)?.meta.category, text).toBe(category);
    }
  });

  it('detects income and sets the 收入 category', () => {
    const salary = parseEntry('工资 ¥8500', NOW);
    expect(salary?.kind).toBe('finance');
    expect(salary?.meta.direction).toBe('income');
    expect(salary?.meta.category).toBe('收入');
    expect(salary?.meta.amount).toBe(8500);

    const redPacket = parseEntry('收到红包 200 元', NOW);
    expect(redPacket?.meta.direction).toBe('income');
    expect(redPacket?.meta.amount).toBe(200);
  });

  it('accepts ¥ before the number and amounts without Han characters', () => {
    expect(parseEntry('打车 ¥30', NOW)?.meta.amount).toBe(30);
    const bare = parseEntry('¥32', NOW);
    expect(bare?.kind).toBe('finance');
    expect(bare?.meta.amount).toBe(32);
  });
});

describe('parseEntry — health', () => {
  it('parses weight, including 斤 conversion', () => {
    const weight = parseEntry('体重 52.4 kg', NOW);
    expect(weight?.kind).toBe('health');
    expect(weight?.meta.metric).toBe('体重');
    expect(weight?.meta.value).toBe(52.4);
    expect(weight?.meta.unit).toBe('kg');
    expect(weight?.title).toBe('体重 52.4 kg');

    const jin = parseEntry('称重 110 斤', NOW);
    expect(jin?.meta.metric).toBe('体重');
    expect(jin?.meta.value).toBe(55);
  });

  it('parses sleep hours', () => {
    const draft = parseEntry('昨晚睡了 7.5 小时', NOW);
    expect(draft?.kind).toBe('health');
    expect(draft?.meta.metric).toBe('睡眠');
    expect(draft?.meta.value).toBe(7.5);
    expect(draft?.meta.unit).toBe('小时');
  });

  it('parses steps with 万 conversion', () => {
    expect(parseEntry('今天走了 1.2 万步', NOW)?.meta.value).toBe(12000);
    expect(parseEntry('步数 8321 步', NOW)?.meta.value).toBe(8321);
  });

  it('parses water in ml and cups', () => {
    const ml = parseEntry('喝水 500 ml', NOW);
    expect(ml?.meta.metric).toBe('饮水');
    expect(ml?.meta.value).toBe(500);
    expect(ml?.meta.unit).toBe('ml');

    const cups = parseEntry('喝了 2 杯水', NOW);
    expect(cups?.meta.metric).toBe('饮水');
    expect(cups?.meta.value).toBe(500);
  });

  it('parses exercise in minutes and kilometres', () => {
    const minutes = parseEntry('健身 30 分钟', NOW);
    expect(minutes?.meta.metric).toBe('运动');
    expect(minutes?.meta.value).toBe(30);
    expect(minutes?.meta.unit).toBe('分钟');
    expect(minutes?.title).toBe('健身 30 分钟');

    const km = parseEntry('跑步 5 公里', NOW);
    expect(km?.meta.metric).toBe('运动');
    expect(km?.meta.value).toBe(5);
    expect(km?.meta.unit).toBe('公里');
    expect(km?.title).toBe('跑步 5 公里');
  });

  it('treats walking time as exercise when no step count is given', () => {
    const draft = parseEntry('走了 30 分钟', NOW);
    expect(draft?.kind).toBe('health');
    expect(draft?.meta.metric).toBe('运动');
    expect(draft?.meta.value).toBe(30);
  });

  it('parses mood entries', () => {
    const draft = parseEntry('心情 开心', NOW);
    expect(draft?.kind).toBe('health');
    expect(draft?.meta.metric).toBe('心情');
    expect(draft?.meta.mood).toBe('开心');
    expect(draft?.title).toContain('开心');
  });
});

describe('parseEntry — diary and rejections', () => {
  it('falls back to a diary draft for declarative sentences', () => {
    const draft = parseEntry('今天有点累', NOW);
    expect(draft?.kind).toBe('diary');
    expect(draft?.meta.mood).toBe('累');
    expect(draft?.content).toContain('#日记');
    expect(draft?.title.length).toBeGreaterThan(0);
    expect(draft?.confidence).toBe(0.5);
  });

  it('marks explicit diary text with higher confidence', () => {
    const draft = parseEntry('记录一下：今天很平静', NOW);
    expect(draft?.kind).toBe('diary');
    expect(draft?.meta.mood).toBe('平静');
    expect(draft?.confidence).toBe(0.7);
  });

  it('never parses questions', () => {
    for (const text of [
      '今天花了多少？',
      '本周饮食总结',
      '最近睡眠怎么样？',
      '你给我一点建议吧',
      '能帮我总结一下吗',
    ]) {
      expect(parseEntry(text, NOW), text).toBeNull();
    }
  });

  it('rejects blank, greeting and gibberish input', () => {
    for (const text of ['', '   ', 'asdfgh', '😀😀', '你好', '早上好', '好的', '嗯嗯', '123456']) {
      expect(parseEntry(text, NOW), JSON.stringify(text)).toBeNull();
    }
  });

  it('is deterministic for the same input and clock', () => {
    expect(parseEntry('午饭牛肉面 32 元 620 千卡', NOW)).toEqual(
      parseEntry('午饭牛肉面 32 元 620 千卡', NOW),
    );
    expect(parseEntry('今天有点累', NOW)).toEqual(parseEntry('今天有点累', NOW));
  });
});

describe('captureDraft', () => {
  it('behaves like parseEntry without a kind hint', () => {
    expect(captureDraft('打车 30 元', undefined, NOW)).toEqual(parseEntry('打车 30 元', NOW));
  });

  it('coerces the draft to the requested kind while extracting fields', () => {
    const food = captureDraft('打车 30 元', 'food', NOW);
    expect(food?.kind).toBe('food');
    expect(food?.meta.amount).toBe(30);
    expect(food?.content).toContain('#饮食');

    const finance = captureDraft('午饭牛肉面 32 元 620 千卡', 'finance', NOW);
    expect(finance?.kind).toBe('finance');
    expect(finance?.meta.amount).toBe(32);
    expect(finance?.meta.category).toBe('餐饮');

    const health = captureDraft('52.4 kg', 'health', NOW);
    expect(health?.kind).toBe('health');
    expect(health?.meta.metric).toBe('体重');
    expect(health?.meta.value).toBe(52.4);

    const diary = captureDraft('今天很平静', 'diary', NOW);
    expect(diary?.kind).toBe('diary');
    expect(diary?.meta.mood).toBe('平静');
    expect(diary?.confidence).toBe(0.7);

    const note = captureDraft('随便写点想法', 'note', NOW);
    expect(note?.kind).toBe('note');
    expect(note?.content).toBe('随便写点想法');
  });

  it('still rejects questions and blank text', () => {
    expect(captureDraft('今天花了多少？', 'food', NOW)).toBeNull();
    expect(captureDraft('', 'food', NOW)).toBeNull();
    expect(captureDraft('你好', 'diary', NOW)).toBeNull();
  });
});

describe('agentReply — summaries', () => {
  it('answers a spending question with local totals', () => {
    const reply = agentReply('今天花了多少？', VAULT, NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('¥58');
    expect(reply.text).toContain('餐饮');
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(reply.suggestions?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('answers a diet question for the week', () => {
    const reply = agentReply('本周饮食总结', VAULT, NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('2 顿饮食');
    expect(reply.text).toContain('1100 kcal');
  });

  it('answers a sleep question with the week average', () => {
    const reply = agentReply('最近睡眠怎么样？', VAULT, NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('睡眠平均');
    expect(reply.text).toContain('7.2');
  });

  it('counts records for "今天记了几条"', () => {
    const reply = agentReply('今天记了几条？', VAULT, NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('10 条记录');
  });

  it('copes with an empty vault', () => {
    const reply = agentReply('今天花了多少？', [], NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('还没有记录');
  });
});

describe('agentReply — capture', () => {
  it('offers to save a parsed food record', () => {
    const reply = agentReply('奶茶 18 元', VAULT, NOW);
    expect(reply.intent).toBe('capture');
    expect(reply.action?.type).toBe('createNote');
    expect(reply.action?.draft.kind).toBe('food');
    expect(reply.action?.draft.meta.amount).toBe(18);
    expect(reply.text).toContain('帮你记一笔');
    expect(reply.text).toContain('确认后保存');
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('treats an explicit capture command as capture', () => {
    const reply = agentReply('帮我记一笔 跑步 30 分钟', VAULT, NOW);
    expect(reply.intent).toBe('capture');
    expect(reply.action?.draft.kind).toBe('health');
    expect(reply.action?.draft.meta.metric).toBe('运动');
    expect(reply.action?.draft.meta.value).toBe(30);
  });

  it('offers to save a diary sentence', () => {
    const reply = agentReply('今天有点累', VAULT, NOW);
    expect(reply.intent).toBe('capture');
    expect(reply.action?.draft.kind).toBe('diary');
  });
});

describe('agentReply — advice, help and fallback', () => {
  it('answers advice questions when data exists', () => {
    const reply = agentReply('给我一点建议吧', VAULT, NOW);
    expect(reply.intent).toBe('advice');
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('answers help questions', () => {
    const reply = agentReply('你能做什么？', VAULT, NOW);
    expect(reply.intent).toBe('help');
    expect(reply.text).toContain('本地');
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('falls back politely for unclear input', () => {
    const gibberish = agentReply('asdfgh', VAULT, NOW);
    expect(gibberish.intent).toBe('fallback');
    expect(gibberish.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);

    const greeting = agentReply('你好', VAULT, NOW);
    expect(greeting.intent).toBe('fallback');
  });

  it('is deterministic for the same question and clock', () => {
    const first = agentReply('今天花了多少？', VAULT, NOW);
    const second = agentReply('今天花了多少？', VAULT, NOW);
    expect(first).toEqual(second);

    const captureFirst = agentReply('奶茶 18 元', VAULT, NOW);
    const captureSecond = agentReply('奶茶 18 元', VAULT, NOW);
    expect(captureFirst).toEqual(captureSecond);
  });
});

describe('agentGreeting', () => {
  it('summarizes today and offers prompt chips', () => {
    const reply: AgentReply = agentGreeting(VAULT, NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('今天已经记了 10 条');
    expect(reply.text).toContain('支出 ¥58');
    expect(reply.text).toContain('摄入 1100 kcal');
    expect(reply.text).toContain('睡眠 7.2 小时');
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(reply.suggestions?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('greets with a gentle nudge on an empty day', () => {
    const reply = agentGreeting([], NOW);
    expect(reply.intent).toBe('summary');
    expect(reply.text).toContain('还没有记录');
    expect(reply.suggestions?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(agentGreeting(VAULT, NOW)).toEqual(agentGreeting(VAULT, NOW));
  });
});

describe('AGENT_SUGGESTIONS', () => {
  it('offers non-empty starter prompts', () => {
    expect(AGENT_SUGGESTIONS.length).toBeGreaterThanOrEqual(4);
    for (const suggestion of AGENT_SUGGESTIONS) {
      expect(typeof suggestion).toBe('string');
      expect(suggestion.length).toBeGreaterThan(0);
    }
    expect(AGENT_SUGGESTIONS).toContain('今天花了多少？');
  });
});
