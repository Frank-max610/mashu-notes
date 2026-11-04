import type { Note } from './types';
import { dayKeyOf, noteDayKey } from './insights';

export interface SmallTalkReply {
  text: string;
  suggestions?: string[];
}

function todayLine(notes: Note[], now = new Date()): string {
  const key = dayKeyOf(now);
  const count = notes.filter((note) => noteDayKey(note) === key && !note.meta.directory && !note.archivedAt).length;
  return count === 0 ? '今天还空着。' : `今天已经记了 ${count} 条。`;
}

/**
 * Light conversation layer. This never invents factual answers — it only handles
 * social/emotional turns, while factual questions go through the knowledge base.
 */
export function smallTalkReply(
  input: string,
  notes: Note[],
  personaName = '小麻薯',
  now = new Date(),
): SmallTalkReply | null {
  const text = input.trim();
  if (!text) return null;

  if (/^(你好|嗨|哈喽|在吗|早上好|中午好|晚上好|早安|晚安)[。！？!?\s]*$/.test(text) || /^(你好|嗨|哈喽)/.test(text)) {
    if (/晚安/.test(text)) {
      return { text: `晚安。${todayLine(notes, now)}睡个好觉，明天想记的时候我还在。`, suggestions: ['明天记得写一句', '看一眼生活图谱'] };
    }
    return {
      text: `${personaName}在。${todayLine(notes, now)}今天想记点什么，还是随便聊聊？`,
      suggestions: ['今天有点累', '陪我聊会儿', '今天发生了什么'],
    };
  }

  if (/谢谢|感谢|多谢/.test(text)) {
    return { text: '不客气呀。能帮你把日子记下来，我就挺开心的。', suggestions: ['再记一笔', '看看今天的汇总'] };
  }

  if (/你是谁|你叫什么|你是什么|介绍一下自己/.test(text)) {
    return {
      text: `我是${personaName}，住在你手机里的本地小助手。我不联网，只根据你自己的记录说话，也能陪你聊两句。`,
      suggestions: ['你能做什么', '我有点累'],
    };
  }

  if (/(累|烦|难过|焦虑|压力|不开心|崩溃|委屈|失眠|睡不着)/.test(text)) {
    return {
      text: '听起来今天不太轻松。先不用急着振作，要不要用一句话把现在的感觉记下来？不想写也没关系，我陪你待一会儿。',
      suggestions: ['记一条心情', '陪我说说话', '今天发生了什么'],
    };
  }

  if (/(无聊|陪我|聊聊|聊会|在干嘛|干什么呢)/.test(text)) {
    return {
      text: '我在呀。今天有没有一件很小的事，值得记下来？比如吃了什么、见了谁、哪一刻稍微开心了一点。',
      suggestions: ['今天吃了一碗面', '今天没什么特别的', '给我一点建议'],
    };
  }

  if (/(开心|高兴|太好了|好耶|不错|顺利|完成)/.test(text)) {
    return {
      text: '这听起来值得记一笔。要不说说是什么事，我帮你放进今天的记录里？',
      suggestions: ['记下这件开心事', '看看最近的变化'],
    };
  }

  if (/(喜欢你|你好棒|真棒|可爱|谢谢你)/.test(text)) {
    return { text: '被你这么一说，我会更认真一点的。', suggestions: ['再聊一会儿', '记一笔今天'] };
  }

  if (/(我回来了|好久不见|早|晚安)/.test(text)) {
    return { text: `${todayLine(notes, now)}我在，慢慢来。`, suggestions: ['写一句日记', '看看日历'] };
  }

  return null;
}
