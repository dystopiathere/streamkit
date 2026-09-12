import { describe, expect, it } from 'vitest';
import {
  chatChannelSchema,
  chatMessageSchema,
  emoteUrl,
  splitEmotes,
  twitchLoginSchema,
} from './chat.js';
import { chatWidgetConfigSchema } from './widgets.js';

describe('логин канала', () => {
  it('приводит регистр к нижнему', () => {
    // IRC-канал называется #shroud, а в настройки впишут «Shroud». Без
    // нормализации ключ комнаты доставки разошёлся бы с тегом в сообщении.
    expect(twitchLoginSchema.parse('  Shroud  ')).toBe('shroud');
  });

  it('отвергает то, что каналом быть не может', () => {
    expect(twitchLoginSchema.safeParse('ab').success).toBe(false);
    expect(twitchLoginSchema.safeParse('два слова').success).toBe(false);
    expect(twitchLoginSchema.safeParse('../admin').success).toBe(false);
  });

  it('в настройках допускает пустоту — виджет создают раньше, чем настраивают', () => {
    expect(chatChannelSchema.parse('')).toBe('');
    expect(chatChannelSchema.safeParse('не логин').success).toBe(false);
  });
});

/**
 * Twitch нумерует позиции эмоутов в КОДОВЫХ ТОЧКАХ, а не в единицах UTF-16,
 * которыми меряет slice. Одна эмодзи сдвигает все последующие эмоуты, и
 * картинки уезжают на соседние слова — заметить это на глаз почти невозможно.
 */
describe('разбор эмоутов', () => {
  it('режет текст по кодовым точкам, а не по индексам строки', () => {
    const parts = splitEmotes('🎉 Kappa вот', [{ id: '25', start: 2, end: 6 }]);
    expect(parts).toEqual([
      { kind: 'text', value: '🎉 ' },
      { kind: 'emote', id: '25', alt: 'Kappa' },
      { kind: 'text', value: ' вот' },
    ]);
  });

  it('расставляет несколько эмоутов независимо от порядка диапазонов', () => {
    const parts = splitEmotes('Kappa и Kappa', [
      { id: '25', start: 8, end: 12 },
      { id: '25', start: 0, end: 4 },
    ]);
    expect(parts.map((part) => part.kind)).toEqual(['emote', 'text', 'emote']);
  });

  it('сообщение без эмоутов остаётся одним куском текста', () => {
    expect(splitEmotes('просто текст', [])).toEqual([{ kind: 'text', value: 'просто текст' }]);
  });

  it('пропускает битые диапазоны, а не роняет сообщение', () => {
    // Это данные из сети, а не наши. Испорченный диапазон означает «покажи
    // текстом», а не «промолчи»: чат в эфире молчать не должен.
    const parts = splitEmotes('Kappa', [
      { id: '25', start: 10, end: 20 },
      { id: '25', start: -1, end: 2 },
    ]);
    expect(parts).toEqual([{ kind: 'text', value: 'Kappa' }]);
  });

  it('пропускает пересекающиеся диапазоны', () => {
    const parts = splitEmotes('Kappa', [
      { id: '25', start: 0, end: 4 },
      { id: '1902', start: 2, end: 4 },
    ]);
    expect(parts).toEqual([{ kind: 'emote', id: '25', alt: 'Kappa' }]);
  });
});

describe('адрес эмоута', () => {
  it('собирается из идентификатора, а не приходит ссылкой', () => {
    expect(emoteUrl('25')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');
  });

  it('идентификатор ограничен схемой — чужой адрес из него не собрать', () => {
    const message = {
      id: 'a',
      platform: 'twitch',
      channel: 'example',
      login: 'viewer',
      username: 'Зритель',
      color: null,
      badges: [],
      parts: [{ kind: 'emote', id: '../../evil', alt: 'x' }],
      sentAt: '2026-09-12T20:00:00.000Z',
    };
    expect(chatMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('конфиг чата', () => {
  it('по умолчанию прячет привычных ботов', () => {
    expect(chatWidgetConfigSchema.parse({}).hiddenUsers).toContain('nightbot');
  });

  it('нормализует вписанные ники', () => {
    expect(chatWidgetConfigSchema.parse({ hiddenUsers: ['NightBot'] }).hiddenUsers).toEqual([
      'nightbot',
    ]);
  });

  it('отвергает неизвестный значок, но не роняет остальные', () => {
    // Список значков Twitch открыт: неизвестные отбрасывает сервер при разборе,
    // а схема описывает ровно то, что виджет умеет нарисовать.
    const badges = ['moderator', 'glhf-pledge'];
    expect(chatMessageSchema.shape.badges.safeParse(badges).success).toBe(false);
    expect(chatMessageSchema.shape.badges.safeParse(['moderator']).success).toBe(true);
  });
});
