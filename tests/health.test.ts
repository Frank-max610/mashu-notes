import { describe, expect, it } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import {
  decodeHealthPayload,
  healthSamplesToNotes,
  parseHealthCsv,
  parseHealthJson,
  type HealthSample,
  type HealthSampleType,
} from '../src/lib/health';
import { summarizeDay } from '../src/lib/insights';
import { buildDailyBrief } from '../src/lib/brief';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let counter = 0;

interface NoteInput {
  id?: string;
  title?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  content?: string;
  ts?: number;
}

function makeNote(input: NoteInput): Note {
  counter += 1;
  const createdAt = input.ts ?? new Date(2026, 2, 10, 12, 0).getTime();
  const meta: NoteMeta = { ...input.meta };
  if (input.ts !== undefined) meta.occurredAt = input.ts;
  return {
    id: input.id ?? `health-note-${counter}`,
    title: input.title ?? '健康记录',
    tags: [],
    createdAt,
    updatedAt: createdAt,
    pinned: false,
    kind: input.kind ?? 'health',
    content: input.content ?? '',
    meta,
    manualLinks: [],
  };
}

/** Parse exactly one sample from a JSON array payload. */
function single(type: string, value: unknown, unit?: string): HealthSample | undefined {
  const payload = JSON.stringify([{ type, value, unit, date: '2026-03-10T08:00:00Z' }]);
  return parseHealthJson(payload).samples[0];
}

/** UTF-8-safe base64url helper for the Shortcuts payload test. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/* JSON parsing                                                        */
/* ------------------------------------------------------------------ */

describe('parseHealthJson — shapes and aliases', () => {
  it('parses an array of Shortcuts-style objects into canonical samples', () => {
    const parsed = parseHealthJson(
      JSON.stringify([
        { type: 'stepCount', value: 8321, date: '2026-03-10T08:00:00Z', unit: 'count', source: 'Apple Watch' },
        { type: 'sleepAnalysis', value: 450, unit: 'minutes', date: '2026-03-10T07:00:00Z' },
        { type: '心率', value: 62, date: '2026-03-10T07:10:00Z' },
        { type: 'dietaryWater', value: 1.5, unit: 'L', date: '2026-03-10T10:00:00Z' },
      ]),
    );

    expect(parsed.skipped).toBe(0);
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.samples[0]).toEqual({
      type: 'steps',
      value: 8321,
      unit: '步',
      date: '2026-03-10T08:00:00.000Z',
      source: 'Apple Watch',
    });
    expect(parsed.samples[1]).toEqual({
      type: 'sleep',
      value: 7.5,
      unit: '小时',
      date: '2026-03-10T07:00:00.000Z',
    });
    expect(parsed.samples[2]).toEqual({
      type: 'heartRate',
      value: 62,
      unit: 'bpm',
      date: '2026-03-10T07:10:00.000Z',
    });
    expect(parsed.samples[3]).toEqual({
      type: 'water',
      value: 1500,
      unit: 'ml',
      date: '2026-03-10T10:00:00.000Z',
    });
  });

  it('accepts a single Shortcuts object with string values', () => {
    const parsed = parseHealthJson(
      '{"type":"bodyMass","value":"52.4","unit":"kg","date":"2026-03-10T07:00:00+08:00","source":"Apple Watch"}',
    );

    expect(parsed.skipped).toBe(0);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]).toMatchObject({
      type: 'weight',
      value: 52.4,
      unit: 'kg',
      date: '2026-03-09T23:00:00.000Z',
      source: 'Apple Watch',
    });
  });

  it('accepts a { samples: [...] } wrapper and counts invalid items as skipped', () => {
    const parsed = parseHealthJson(
      JSON.stringify({
        samples: [
          { type: 'steps', value: 1000, date: '2026-03-10T08:00:00Z' },
          { type: 'unknown-metric', value: 1, date: '2026-03-10T08:00:00Z' },
          { type: 'steps', value: -5, date: '2026-03-10T08:00:00Z' },
          { type: 'steps', value: 100 },
          'oops',
        ],
      }),
    );

    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0].value).toBe(1000);
    expect(parsed.skipped).toBe(4);
  });

  it('maps every documented alias to its canonical type', () => {
    const aliases: ReadonlyArray<readonly [string, HealthSampleType, number]> = [
      ['stepCount', 'steps', 4000],
      ['steps', 'steps', 4000],
      ['步数', 'steps', 4000],
      ['sleep', 'sleep', 7],
      ['sleepAnalysis', 'sleep', 7],
      ['睡眠', 'sleep', 7],
      ['heartRate', 'heartRate', 62],
      ['心率', 'heartRate', 62],
      ['restingHeartRate', 'restingHeartRate', 55],
      ['静息心率', 'restingHeartRate', 55],
      ['bodyMass', 'weight', 52],
      ['weight', 'weight', 52],
      ['体重', 'weight', 52],
      ['dietaryWater', 'water', 500],
      ['water', 'water', 500],
      ['饮水', 'water', 500],
      ['activeEnergyBurned', 'activeEnergy', 420],
      ['activeEnergy', 'activeEnergy', 420],
      ['活动能量', 'activeEnergy', 420],
      ['workout', 'workout', 30],
      ['运动', 'workout', 30],
    ];

    for (const [alias, expectedType, value] of aliases) {
      const sample = single(alias, value);
      expect(sample?.type, `alias ${alias}`).toBe(expectedType);
    }
  });

  it('accepts HealthKit identifiers sent by Shortcuts', () => {
    expect(single('HKQuantityTypeIdentifierStepCount', 5000)?.type).toBe('steps');
    expect(single('HKQuantityTypeIdentifierRestingHeartRate', 55)?.type).toBe(
      'restingHeartRate',
    );
    expect(single('HKCategoryTypeIdentifierSleepAnalysis', 7)?.type).toBe('sleep');
  });
});

describe('parseHealthJson — unit conversion', () => {
  it('converts pounds, grams and 斤 to kg', () => {
    expect(single('bodyMass', 150, 'lb')?.value).toBe(68);
    expect(single('bodyMass', 104, '斤')?.value).toBe(52);
    expect(single('bodyMass', 52400, 'g')?.value).toBe(52.4);
  });

  it('converts litres to ml and minutes to hours', () => {
    expect(single('dietaryWater', 1.5, 'L')?.value).toBe(1500);
    expect(single('dietaryWater', 2, '升')?.value).toBe(2000);
    expect(single('sleepAnalysis', 450, 'minutes')?.value).toBe(7.5);
    expect(single('sleepAnalysis', 7.25, 'hours')?.value).toBe(7.25);
  });

  it('converts workout hours/minutes/miles and kilojoules to kcal', () => {
    expect(single('workout', 1.5, 'h')?.value).toBe(90);
    expect(single('workout', 45, 'min')?.value).toBe(45);
    expect(single('workout', 2, 'miles')?.value).toBe(3.22);
    expect(single('activeEnergyBurned', 1000, 'kJ')?.value).toBe(239);
  });

  it('treats unitless sleep values over 24 as minutes', () => {
    expect(single('sleepAnalysis', 420)?.value).toBe(7);
    expect(single('sleepAnalysis', 7.2)?.value).toBe(7.2);
  });

  it('skips impossible values instead of storing them', () => {
    const parsed = parseHealthJson(
      JSON.stringify([
        { type: 'steps', value: 8321, date: '2026-03-10T08:00:00Z' },
        { type: 'steps', value: -1, date: '2026-03-10T08:00:00Z' },
        { type: 'heartRate', value: 10, date: '2026-03-10T08:00:00Z' },
        { type: 'sleepAnalysis', value: 0, date: '2026-03-10T08:00:00Z' },
        { type: 'bodyMass', value: 'abc', date: '2026-03-10T08:00:00Z' },
        { type: 'bodyMass', value: 52, date: 'not-a-date' },
        { type: 'workout', value: 5000, unit: 'minutes', date: '2026-03-10T08:00:00Z' },
      ]),
    );

    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]).toMatchObject({ type: 'steps', value: 8321 });
    expect(parsed.skipped).toBe(6);
  });

  it('returns an empty result for empty or unusable input', () => {
    expect(parseHealthJson('')).toEqual({ samples: [], skipped: 0 });
    expect(parseHealthJson('   ')).toEqual({ samples: [], skipped: 0 });
    expect(parseHealthJson('{oops')).toEqual({ samples: [], skipped: 1 });
    expect(parseHealthJson('42')).toEqual({ samples: [], skipped: 1 });
    expect(parseHealthJson('null')).toEqual({ samples: [], skipped: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

describe('parseHealthCsv', () => {
  it('reads a header row and skips rows with unknown types', () => {
    const csv = [
      'type,date,value,unit,source',
      'stepCount,2026-03-10T08:00:00Z,8321,count,Apple Watch',
      'sleepAnalysis,2026-03-10T07:00:00Z,450,minutes,',
      '心率,2026-03-10T07:10:00Z,62,bpm,',
      'unknown,2026-03-10T09:00:00Z,1,,',
    ].join('\n');
    const parsed = parseHealthCsv(csv);

    expect(parsed.samples.map((sample) => sample.type)).toEqual(['steps', 'sleep', 'heartRate']);
    expect(parsed.samples[0]).toMatchObject({ value: 8321, unit: '步', source: 'Apple Watch' });
    expect(parsed.samples[1].value).toBe(7.5);
    expect(parsed.skipped).toBe(1);
  });

  it('handles quoted cells, thousands separators and CRLF', () => {
    const csv =
      'type,date,value,unit,source\r\n' +
      '"Steps","2026-03-10T08:00:00Z","8,321",步,"Apple Watch, Series 9"\r\n';
    const parsed = parseHealthCsv(csv);

    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0].value).toBe(8321);
    expect(parsed.samples[0].source).toBe('Apple Watch, Series 9');
  });

  it('accepts Chinese column names and an optional unit column', () => {
    const parsed = parseHealthCsv('类型,日期,数值,单位\n步数,2026-03-10T08:00:00Z,5000,步\n');
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]).toMatchObject({ type: 'steps', value: 5000, unit: '步' });
  });

  it('returns an empty result for empty input and skips a table without required columns', () => {
    expect(parseHealthCsv('')).toEqual({ samples: [], skipped: 0 });
    const bad = parseHealthCsv('hello,world\n1,2\n3,4');
    expect(bad.samples).toEqual([]);
    expect(bad.skipped).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* URL payload                                                         */
/* ------------------------------------------------------------------ */

describe('decodeHealthPayload', () => {
  const json = JSON.stringify([
    { type: '活动能量', value: 420, date: '2026-03-10T08:00:00Z' },
  ]);

  it('accepts raw JSON', () => {
    const parsed = decodeHealthPayload(json);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]).toMatchObject({ type: 'activeEnergy', value: 420, unit: 'kcal' });
  });

  it('accepts base64url-encoded JSON (UTF-8, Chinese aliases survive)', () => {
    const parsed = decodeHealthPayload(toBase64Url(json));
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0].type).toBe('activeEnergy');
    expect(parsed.samples[0].value).toBe(420);
  });

  it('accepts URL-encoded JSON', () => {
    const parsed = decodeHealthPayload(encodeURIComponent(json));
    expect(parsed.samples).toHaveLength(1);
  });

  it('returns skipped=1 for unrecognisable payloads and an empty result for empty input', () => {
    expect(decodeHealthPayload('')).toEqual({ samples: [], skipped: 0 });
    expect(decodeHealthPayload('!!not-json!!')).toEqual({ samples: [], skipped: 1 });
    expect(decodeHealthPayload(toBase64Url('hello'))).toEqual({ samples: [], skipped: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Samples → note drafts                                               */
/* ------------------------------------------------------------------ */

describe('healthSamplesToNotes', () => {
  it('builds health notes with Chinese titles, meta and hashtags', () => {
    const samples: HealthSample[] = [
      { type: 'weight', value: 52.4, unit: 'kg', date: '2026-03-10T07:00:00' },
      { type: 'sleep', value: 7.2, unit: '小时', date: '2026-03-10T07:05:00' },
      { type: 'steps', value: 8321, unit: '步', date: '2026-03-10T08:00:00' },
      { type: 'heartRate', value: 62, unit: 'bpm', date: '2026-03-10T09:00:00' },
      { type: 'water', value: 1500, unit: 'ml', date: '2026-03-10T17:00:00' },
      { type: 'workout', value: 30, unit: '分钟', date: '2026-03-10T18:00:00', detail: '跑步' },
      { type: 'activeEnergy', value: 420, unit: 'kcal', date: '2026-03-10T19:00:00' },
      { type: 'restingHeartRate', value: 55, unit: 'bpm', date: '2026-03-09T09:00:00' },
    ];
    const drafts = healthSamplesToNotes(samples, []);

    expect(drafts).toHaveLength(8);
    expect(drafts.map((draft) => draft.kind)).toEqual(Array(8).fill('health'));
    expect(drafts.map((draft) => draft.title)).toEqual([
      '静息心率 55 bpm',
      '体重 52.4 kg',
      '睡眠 7.2 小时',
      '步数 8321 步',
      '心率 62 bpm',
      '饮水 1500 ml',
      '跑步 30 分钟',
      '活动能量 420 kcal',
    ]);

    const steps = drafts.find((draft) => draft.meta.metric === '步数');
    expect(steps?.meta).toMatchObject({ metric: '步数', value: 8321, unit: '步' });
    expect(steps?.meta.occurredAt).toBe(new Date(2026, 2, 10, 8, 0).getTime());
    expect(steps?.content).toContain('步数 8321 步');
    expect(steps?.content).toContain('#健康');
    expect(steps?.content).toContain('#Apple健康');

    const workout = drafts.find((draft) => draft.meta.metric === '运动');
    expect(workout?.meta).toMatchObject({ value: 30, unit: '分钟', detail: '跑步' });
    expect(drafts.every((draft) => !('replaceId' in draft))).toBe(true);
    for (const draft of drafts) {
      expect(draft.content).not.toContain('NaN');
      expect(draft.content).not.toContain('undefined');
    }
  });

  it('keeps workout distance in kilometres and maps English activity names', () => {
    const drafts = healthSamplesToNotes(
      [
        { type: 'workout', value: 3.5, unit: '公里', date: '2026-03-10T18:00:00', detail: '夜跑' },
        { type: 'workout', value: 45, unit: '分钟', date: '2026-03-11T18:00:00', detail: 'Outdoor Running' },
      ],
      [],
    );

    expect(drafts[0].title).toBe('夜跑 3.5 公里');
    expect(drafts[0].meta.unit).toBe('公里');
    expect(drafts[1].title).toBe('跑步 45 分钟');
  });

  it('sums running totals but keeps the latest point value', () => {
    const samples: HealthSample[] = [
      { type: 'steps', value: 5000, date: '2026-03-10T08:00:00' },
      { type: 'steps', value: 3321, date: '2026-03-10T18:00:00' },
      { type: 'water', value: 500, date: '2026-03-10T09:00:00' },
      { type: 'water', value: 1000, date: '2026-03-10T15:00:00' },
      { type: 'activeEnergy', value: 200, date: '2026-03-10T10:00:00' },
      { type: 'activeEnergy', value: 220, date: '2026-03-10T20:00:00' },
      { type: 'sleep', value: 6.5, date: '2026-03-10T07:00:00' },
      { type: 'sleep', value: 7.2, date: '2026-03-10T08:00:00' },
      { type: 'weight', value: 52.6, date: '2026-03-10T07:00:00' },
      { type: 'weight', value: 52.4, date: '2026-03-10T07:30:00' },
      { type: 'heartRate', value: 70, date: '2026-03-10T09:00:00' },
      { type: 'heartRate', value: 62, date: '2026-03-10T10:00:00' },
    ];
    const drafts = healthSamplesToNotes(samples, []);
    const byMetric = new Map(drafts.map((draft) => [draft.meta.metric, draft]));

    expect(drafts).toHaveLength(6);
    expect(byMetric.get('步数')?.meta.value).toBe(8321);
    expect(byMetric.get('饮水')?.meta.value).toBe(1500);
    expect(byMetric.get('活动能量')?.meta.value).toBe(420);
    expect(byMetric.get('睡眠')?.meta.value).toBe(7.2);
    expect(byMetric.get('体重')?.meta.value).toBe(52.4);
    expect(byMetric.get('心率')?.meta.value).toBe(62);
    expect(byMetric.get('步数')?.content).toContain('合并 2 条样本');
  });

  it('replaces an existing same-day metric note instead of duplicating it', () => {
    const existing: Note[] = [
      makeNote({
        id: 'h-steps',
        meta: { metric: '步数', value: 1000, unit: '步', occurredAt: new Date(2026, 2, 10, 1).getTime() },
      }),
      makeNote({
        id: 'h-sleep-yesterday',
        meta: { metric: '睡眠', value: 7, unit: '小时', occurredAt: new Date(2026, 2, 9, 1).getTime() },
      }),
    ];
    const drafts = healthSamplesToNotes(
      [
        { type: 'steps', value: 8321, date: '2026-03-10T08:00:00' },
        { type: 'sleep', value: 7.2, date: '2026-03-10T07:00:00' },
        { type: 'water', value: 1500, date: '2026-03-10T17:00:00' },
      ],
      existing,
    );
    const byMetric = new Map(drafts.map((draft) => [draft.meta.metric, draft]));

    expect(byMetric.get('步数')?.replaceId).toBe('h-steps');
    expect(byMetric.get('睡眠') && 'replaceId' in byMetric.get('睡眠')!).toBe(false);
    expect(byMetric.get('饮水') && 'replaceId' in byMetric.get('饮水')!).toBe(false);
  });

  it('picks the newest existing note when a day has several', () => {
    const existing: Note[] = [
      makeNote({
        id: 'older',
        meta: { metric: '步数', value: 100, occurredAt: new Date(2026, 2, 10, 8).getTime() },
      }),
      makeNote({
        id: 'newer',
        meta: { metric: '步数', value: 200, occurredAt: new Date(2026, 2, 10, 20).getTime() },
      }),
    ];
    const drafts = healthSamplesToNotes(
      [{ type: 'steps', value: 8321, date: '2026-03-10T23:00:00' }],
      existing,
    );

    expect(drafts[0].replaceId).toBe('newer');
  });

  it('returns one draft per local day and sorts by day then metric', () => {
    const drafts = healthSamplesToNotes(
      [
        { type: 'steps', value: 1000, date: '2026-03-11T08:00:00' },
        { type: 'steps', value: 2000, date: '2026-03-10T08:00:00' },
        { type: 'sleep', value: 7, date: '2026-03-10T07:00:00' },
      ],
      [],
    );

    expect(drafts.map((draft) => draft.title)).toEqual([
      '睡眠 7 小时',
      '步数 2000 步',
      '步数 1000 步',
    ]);
  });

  it('silently drops unusable samples', () => {
    const drafts = healthSamplesToNotes(
      [
        { type: 'unknown' as HealthSampleType, value: 1, date: '2026-03-10T08:00:00' },
        { type: 'steps', value: 100, date: 'not-a-date' },
        { type: 'steps', value: -5, date: '2026-03-10T08:00:00' },
        { type: 'steps', value: 5000, date: '2026-03-10T08:00:00' },
      ],
      [],
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe('步数 5000 步');
  });
});

/* ------------------------------------------------------------------ */
/* Round trip: payload → samples → notes → insights / brief            */
/* ------------------------------------------------------------------ */

describe('Apple Health round trip', () => {
  it('imports a payload into notes that the insights and the daily brief understand', () => {
    const payload = JSON.stringify({
      samples: [
        { type: 'stepCount', value: 8321, unit: '步', date: '2026-03-10T08:00:00' },
        { type: 'sleepAnalysis', value: 7.2, unit: 'hours', date: '2026-03-10T07:00:00' },
        { type: 'dietaryWater', value: 1.5, unit: 'L', date: '2026-03-10T17:00:00' },
        { type: 'activeEnergyBurned', value: 420, unit: 'kcal', date: '2026-03-10T19:00:00' },
        { type: 'restingHeartRate', value: 55, unit: 'bpm', date: '2026-03-10T06:30:00' },
      ],
    });

    const parsed = parseHealthJson(payload);
    expect(parsed.skipped).toBe(0);
    const drafts = healthSamplesToNotes(parsed.samples, []);
    expect(drafts).toHaveLength(5);

    // Simulate the store saving the drafts as ordinary health records.
    const notes: Note[] = drafts.map((draft, index) =>
      makeNote({
        id: `imported-${index}`,
        title: draft.title,
        content: draft.content,
        meta: { ...draft.meta },
      }),
    );

    const summary = summarizeDay(notes, new Date(2026, 2, 10, 23, 0));
    expect(summary.recordCount).toBe(5);
    expect(summary.steps).toBe(8321);
    expect(summary.sleep).toBe(7.2);
    expect(summary.water).toBe(1500);

    const brief = buildDailyBrief(notes, new Date(2026, 2, 11, 8, 0));
    expect(brief.review.some((line) => line.includes('8321 步'))).toBe(true);
    expect(brief.review.some((line) => line.includes('7.2 小时'))).toBe(true);

    // Importing the same payload again updates the same five notes.
    const again = healthSamplesToNotes(parsed.samples, notes);
    expect(again).toHaveLength(5);
    expect(again.every((draft) => draft.replaceId !== undefined)).toBe(true);
  });

  it('round-trips a base64url Shortcuts link into notes', () => {
    const payload = JSON.stringify([
      { type: '步数', value: 6500, date: '2026-03-10T08:00:00' },
      { type: '睡眠', value: 6.8, date: '2026-03-10T07:00:00' },
    ]);
    const parsed = decodeHealthPayload(toBase64Url(payload));
    expect(parsed.samples).toHaveLength(2);

    const drafts = healthSamplesToNotes(parsed.samples, []);
    expect(drafts.map((draft) => draft.title)).toEqual(['睡眠 6.8 小时', '步数 6500 步']);
    expect(drafts.every((draft) => draft.content.includes('#Apple健康'))).toBe(true);
  });
});
