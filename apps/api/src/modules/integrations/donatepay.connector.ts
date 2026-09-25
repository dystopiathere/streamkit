import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CURRENCIES,
  type Currency,
  type IncomingAlertEvent,
  parseMajorToMinor,
} from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { PlatformAuthError, PlatformRateLimitError } from '../../common/http/platform-errors';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DonatePayApi, type DonatePayTransaction } from './donatepay.api';
import type { ConnectorContext, DonationConnector } from './donation-provider';

/**
 * Шаг опроса. DonatePay пускает к методу один запрос на ключ примерно в
 * двадцать секунд — чаще спрашивать бесполезно, получим 429.
 */
export const DONATEPAY_POLL_INTERVAL_MS = 20_000;

/**
 * Донат старше этого не показывается в кадре, даже если мы его ещё не видели.
 *
 * Так выглядит возврат после простоя воркера: страница последних донатов
 * целиком «новая», и без отсечки на эфир вывалилась бы пачка оповещений
 * получасовой давности.
 */
export const DONATEPAY_ALERT_FRESH_MS = 10 * 60_000;

/**
 * Донат в статусе ожидания держит курсор — иначе, став успешным, он оказался
 * бы позади курсора и не показался. Но не дольше часа: брошенная оплата может
 * висеть в ожидании вечно и остановила бы курсор навсегда.
 */
export const DONATEPAY_PENDING_HOLD_MS = 60 * 60_000;

/** Курсор живёт в Redis, чтобы перезапуск воркера не терял донаты между опросами. */
const CURSOR_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Ключ курсора: последний донат, после которого все уже разобраны. */
export function donatePayCursorKey(userId: string, accountId: string | null): string {
  return `streamkit:donatepay:cursor:${userId}:${accountId ?? ''}`;
}

/**
 * Коннектор DonatePay: донаты опросом последних транзакций.
 *
 * Сокет у DonatePay есть, но его протокол описан только в документации за
 * входом в кабинет, а публично — лишь в неофициальных клиентах. Писать
 * подключение по догадкам значило бы получить источник, который молча не
 * работает. Опрос опирается только на проверенные методы (`docs/adr/0016`);
 * цена — задержка оповещения до шага опроса.
 */
@Injectable()
export class DonatePayConnector implements DonationConnector {
  readonly provider = 'donatepay' as const;
  private readonly logger = new Logger(DonatePayConnector.name);

  constructor(
    private readonly api: DonatePayApi,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    const session = new DonatePaySession(this.api, this.redis, context, this.logger);
    session.start();
    return () => session.stop();
  }
}

/** Опрос одного стримера. */
class DonatePaySession {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  /** Уже отданные донаты за курсором: курсор может стоять за ожидающим донатом. */
  private readonly emitted = new Set<number>();

  constructor(
    private readonly api: DonatePayApi,
    private readonly redis: Redis,
    private readonly context: ConnectorContext,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll()
        .then((nextDelay) => this.schedule(nextDelay))
        .catch((error: unknown) => {
          this.context.reportFailure(`опрос DonatePay не выполнен: ${describe(error)}`);
          this.schedule(DONATEPAY_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }

  /** @returns пауза до следующего опроса. */
  private async poll(): Promise<number> {
    const { userId, accountId } = this.context;

    // Слот опроса на кластер. Две реплики воркера с одним ключом упирались бы
    // в лимит DonatePay по очереди и получали 429 через раз.
    const slot = await this.redis.set(
      `streamkit:donatepay:poll:${userId}`,
      '1',
      'PX',
      DONATEPAY_POLL_INTERVAL_MS - 1_000,
      'NX',
    );
    if (slot !== 'OK') return DONATEPAY_POLL_INTERVAL_MS;

    let donations: DonatePayTransaction[];
    try {
      const apiKey = await this.context.getAccessToken();
      if (this.stopped) return DONATEPAY_POLL_INTERVAL_MS;
      donations = await this.api.fetchRecentDonations(apiKey);
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        this.stopped = true;
        this.context.onAccessLost('DonatePay не принимает ключ API — вставьте новый ключ');
        return DONATEPAY_POLL_INTERVAL_MS;
      }
      if (error instanceof PlatformRateLimitError) {
        return Math.max(DONATEPAY_POLL_INTERVAL_MS, error.retryAfterMs);
      }
      this.context.reportFailure(`донаты DonatePay недоступны: ${describe(error)}`);
      return DONATEPAY_POLL_INTERVAL_MS;
    }
    if (this.stopped) return DONATEPAY_POLL_INTERVAL_MS;

    const cursorKey = donatePayCursorKey(userId, accountId);
    const stored = await this.redis.get(cursorKey);
    const cursor = stored === null ? null : Number(stored);
    const plan = planDonatePayPoll(donations, cursor, this.emitted, Date.now());

    let nextCursor = plan.cursor;
    for (const donation of plan.emit) {
      const id = Number(donation.id);
      try {
        await this.context.emit(normalizeDonatePayDonation(donation, userId));
        this.emitted.add(id);
      } catch (error) {
        // Не принятый донат остаётся за курсором и повторится на следующем опросе.
        this.logger.error({ err: error, userId }, 'Донат DonatePay не принят');
        nextCursor = Math.min(nextCursor, id - 1);
      }
    }
    nextCursor = Math.max(nextCursor, cursor ?? nextCursor);

    await this.redis.set(cursorKey, String(nextCursor), 'EX', CURSOR_TTL_SECONDS);
    for (const id of this.emitted) if (id <= nextCursor) this.emitted.delete(id);
    return DONATEPAY_POLL_INTERVAL_MS;
  }
}

export interface DonatePayPollPlan {
  /** Что показать сейчас, от старых к новым. */
  emit: DonatePayTransaction[];
  /** Новый курсор: все донаты до него включительно разобраны. */
  cursor: number;
}

/**
 * Что делать со страницей последних донатов.
 *
 * Без курсора — первое подключение: история не показывается, курсор встаёт на
 * самый новый донат. Дальше показываются успешные донаты за курсором, которые
 * ещё не отдавались и не старше `DONATEPAY_ALERT_FRESH_MS`. Курсор идёт вперёд
 * до первого доната, который ещё ждёт оплаты.
 */
export function planDonatePayPoll(
  donations: readonly DonatePayTransaction[],
  cursor: number | null,
  emitted: ReadonlySet<number>,
  now: number,
): DonatePayPollPlan {
  const rows = donations
    .map((donation) => ({ donation, id: transactionId(donation) }))
    .filter((row): row is { donation: DonatePayTransaction; id: number } => row.id !== null)
    .sort((left, right) => left.id - right.id);

  if (cursor === null || !Number.isSafeInteger(cursor)) {
    return { emit: [], cursor: rows.reduce((max, row) => Math.max(max, row.id), 0) };
  }

  const emit: DonatePayTransaction[] = [];
  let next = cursor;
  let settled = true;
  for (const { donation, id } of rows) {
    if (id <= cursor) continue;
    const createdAt = parseDonatePayTime(donation.created_at);
    // Время не разобралось — считаем донат свежим: лучше показать, чем потерять.
    const age = createdAt === null ? 0 : now - createdAt.getTime();
    const status = donation.status ?? 'success';

    if (status === 'success' && !emitted.has(id) && age <= DONATEPAY_ALERT_FRESH_MS) {
      emit.push(donation);
    }
    const pending = status === 'wait' && age < DONATEPAY_PENDING_HOLD_MS;
    if (settled && !pending) next = id;
    else settled = false;
  }
  return { emit, cursor: next };
}

function transactionId(donation: DonatePayTransaction): number | null {
  const id = Number(donation.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Донат DonatePay → наше событие.
 *
 * Сумма приходит строкой или числом в рублях (`"100.00"`) и переводится в
 * копейки через строку — без умножения в плавающей точке. Валюты в известном
 * формате ответа нет: DonatePay.ru принимает рубли. Если поле всё же придёт с
 * валютой, которой у нас нет, сумма считается неизвестной, а донат всё равно
 * показывается — как у DonationAlerts.
 */
export function normalizeDonatePayDonation(
  raw: DonatePayTransaction,
  userId: string,
): IncomingAlertEvent {
  const currency = (raw.currency ?? 'RUB').toUpperCase();
  const amountMinor = parseMajorToMinor(String(raw.sum));
  const knownCurrency = (CURRENCIES as readonly string[]).includes(currency);
  const createdAt = parseDonatePayTime(raw.created_at);

  return {
    userId,
    type: 'donation',
    provider: 'donatepay',
    externalId: String(raw.id),
    username: (raw.vars?.name?.trim() || 'Аноним').slice(0, 64),
    message: (raw.vars?.comment ?? raw.comment ?? '').slice(0, 500),
    audioUrl: null,
    amount:
      amountMinor !== null && amountMinor >= 0 && knownCurrency
        ? { amountMinor, currency: currency as Currency }
        : null,
    count: null,
    isTest: false,
    ...(createdAt ? { occurredAt: createdAt.toISOString() } : {}),
  };
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * Время DonatePay → `Date`.
 *
 * Понимает строку ISO со смещением, `DateTime` PHP (`{ date, timezone }`) с
 * зоной IANA или смещением и местное время без зоны (считается UTC).
 * Неразборчивое — `null`: решение о свежести тогда принимается без времени.
 */
export function parseDonatePayTime(raw: DonatePayTransaction['created_at']): Date | null {
  if (!raw) return null;
  const local = typeof raw === 'string' ? raw.trim() : raw.date.trim();
  const zone = typeof raw === 'string' ? 'UTC' : (raw.timezone?.trim() ?? 'UTC');

  const match = LOCAL_TIME.exec(local);
  if (!match) {
    const parsed = typeof raw === 'string' ? Date.parse(local) : Number.NaN;
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  const offset = zoneOffsetMs(zone, asUtc);
  return offset === null ? null : new Date(asUtc - offset);
}

/** Смещение зоны от UTC в момент `at`: `+03:00`, `UTC` или имя IANA. */
function zoneOffsetMs(zone: string, at: number): number | null {
  const offset = OFFSET.exec(zone);
  if (offset) {
    const [, sign, hours, minutes] = offset;
    const value = (Number(hours) * 60 + Number(minutes)) * 60_000;
    return sign === '-' ? -value : value;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(at));
    const part = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((item) => item.type === type)?.value);
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    return wall - Math.floor(at / 1_000) * 1_000;
  } catch {
    // Неизвестная зона (аббревиатура вроде «MSK») — Intl её не знает.
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
