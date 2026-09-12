import { describe, expect, it } from 'vitest';
import { parseBadges, parseEmotes, parseIrcLine, toChatMessage } from './irc';

const PRIVMSG =
  '@badge-info=;badges=moderator/1,subscriber/12;color=#1E90FF;display-name=Кирилл;' +
  'emotes=25:0-4;id=abc-123;tmi-sent-ts=1789000000000 ' +
  ':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #shroud :Kappa привет';

/**
 * Протокол IRC целиком — это разбор текста, и все его ловушки проверяются без
 * сокета. Каждая из них уже успела кого-то укусить: значения тегов
 * экранированы нестандартно, `PING` обязателен к ответу, `RECONNECT` означает
 * плановое обслуживание площадки.
 */
describe('разбор строки IRC', () => {
  it('вытаскивает теги, отправителя, команду и хвост', () => {
    const line = parseIrcLine(PRIVMSG);

    expect(line?.command).toBe('PRIVMSG');
    expect(line?.prefix).toBe('viewer!viewer@viewer.tmi.twitch.tv');
    expect(line?.params[0]).toBe('#shroud');
    expect(line?.params[1]).toBe('Kappa привет');
    expect(line?.tags.id).toBe('abc-123');
  });

  it('разэкранирует значения тегов по правилам IRCv3', () => {
    // `\s` это пробел, а `\:` — точка с запятой, а не двоеточие. Без этого ник
    // приезжает в кадр с буквальным «\s» посреди слов.
    const line = parseIrcLine(
      String.raw`@display-name=Иван\sПетров;system-msg=a\:b :x!x@x PRIVMSG #c :текст`,
    );
    expect(line?.tags['display-name']).toBe('Иван Петров');
    expect(line?.tags['system-msg']).toBe('a;b');
  });

  it('хвост забирает всё до конца строки, включая пробелы и двоеточия', () => {
    const line = parseIrcLine(':x!x@x PRIVMSG #c :вот: текст с пробелами');
    expect(line?.params[1]).toBe('вот: текст с пробелами');
  });

  it('понимает служебные команды без отправителя', () => {
    expect(parseIrcLine('PING :tmi.twitch.tv')?.command).toBe('PING');
    expect(parseIrcLine('PING :tmi.twitch.tv')?.params[0]).toBe('tmi.twitch.tv');
    expect(parseIrcLine(':tmi.twitch.tv RECONNECT')?.command).toBe('RECONNECT');
  });

  it('молчит на пустой строке и мусоре', () => {
    expect(parseIrcLine('')).toBeNull();
    expect(parseIrcLine('   ')).toBeNull();
    expect(parseIrcLine('@only-tags')).toBeNull();
  });
});

describe('теги значков и эмоутов', () => {
  it('берёт имя значка без уровня', () => {
    expect(parseBadges('moderator/1,subscriber/12')).toEqual(['moderator', 'subscriber']);
  });

  it('отбрасывает неизвестные значки, а не роняет сообщение', () => {
    // Список значков Twitch открыт: новый значок не должен заставлять чат
    // замолчать в день, когда площадка его придумала.
    expect(parseBadges('moderator/1,glhf-pledge/1')).toEqual(['moderator']);
  });

  it('разбирает диапазоны эмоутов, включая повторы одного эмоута', () => {
    expect(parseEmotes('25:0-4,12-16/1902:6-10')).toEqual([
      { id: '25', start: 0, end: 4 },
      { id: '25', start: 12, end: 16 },
      { id: '1902', start: 6, end: 10 },
    ]);
  });

  it('отдаёт только такие идентификаторы, из которых нельзя собрать чужой адрес', () => {
    // Из идентификатора собирается ссылка на CDN. Косая черта или точки в нём
    // означали бы, что площадка решает, откуда оверлей грузит картинки.
    for (const tag of ['../../evil:0-4', 'a/b:0-4', 'a.b:0-4', '25:0-4']) {
      for (const range of parseEmotes(tag)) {
        expect(range.id).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    }
  });
});

describe('PRIVMSG в сообщение чата', () => {
  it('собирает сообщение целиком', () => {
    const message = toChatMessage(parseIrcLine(PRIVMSG)!);

    expect(message?.channel).toBe('shroud');
    expect(message?.login).toBe('viewer');
    expect(message?.username).toBe('Кирилл');
    expect(message?.color).toBe('#1E90FF');
    expect(message?.badges).toEqual(['moderator', 'subscriber']);
    expect(message?.parts).toEqual([
      { kind: 'emote', id: '25', alt: 'Kappa' },
      { kind: 'text', value: ' привет' },
    ]);
    expect(message?.sentAt).toBe(new Date(1_789_000_000_000).toISOString());
  });

  it('снимает обёртку команды /me', () => {
    // Иначе зрители видят в кадре управляющие символы вокруг фразы.
    const line = parseIrcLine(':x!x@x PRIVMSG #c :\u0001ACTION машет рукой\u0001');
    expect(toChatMessage(line!)?.parts).toEqual([{ kind: 'text', value: 'машет рукой' }]);
  });

  it('без display-name показывает логин', () => {
    const line = parseIrcLine(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #c :привет');
    expect(toChatMessage(line!)?.username).toBe('viewer');
  });

  it('без цвета в теге отдаёт null, а не выдуманный цвет', () => {
    // Цвет выберет виджет: подставлять свой на сервере значит решать за
    // оформление, которое настраивает стример.
    const line = parseIrcLine('@color= :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #c :привет');
    expect(toChatMessage(line!)?.color).toBeNull();
  });

  it('своя метка времени только когда площадка её не прислала', () => {
    const fallback = new Date('2026-09-12T20:00:00.000Z');
    const line = parseIrcLine(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #c :привет');
    expect(toChatMessage(line!, fallback)?.sentAt).toBe(fallback.toISOString());
  });

  it('не считает сообщением то, что им не является', () => {
    expect(toChatMessage(parseIrcLine('PING :tmi.twitch.tv')!)).toBeNull();
    // Сообщение от самого сервера: отправителя в форме ника нет.
    expect(toChatMessage(parseIrcLine(':tmi.twitch.tv PRIVMSG #c :привет')!)).toBeNull();
  });
});
