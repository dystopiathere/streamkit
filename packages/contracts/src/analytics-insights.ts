import type { OverviewBucket, StreamSession } from './analytics.js';

/**
 * Выводы из сводки по эфирам: то, что стример читает словами, а не с графика.
 *
 * Считаются здесь, а не на сервере: это чистые функции от уже пришедшей сводки,
 * и дашборд пересчитывает их без запроса. Деньги нигде не становятся дробью —
 * средние в минорных единицах делятся целочисленно (`divideRounded`), а связь
 * считается по рангам, для которых сумма — только повод сравнить два целых.
 */

/**
 * Целочисленное деление с округлением половины вверх.
 *
 * Через BigInt, а не `Math.round(a / b)`: частное двух сумм в копейках — дробь,
 * а правило проекта — ни одной дробной суммы, даже промежуточной.
 */
export function divideRounded(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(
      `Делятся только целые с положительным делителем: ${numerator} / ${denominator}`,
    );
  }
  const a = BigInt(numerator);
  const b = BigInt(denominator);
  const sign = a < 0n ? -1n : 1n;
  return Number(sign * ((sign * a * 2n + b) / (2n * b)));
}

/** Средние ранги: равные значения делят ранг поровну, как положено у Спирмена. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) result[order[i]!.index] = rank;
    start = end + 1;
  }
  return result;
}

/** Меньше трёх эфиров — не связь, а совпадение: коэффициент не показываем. */
export const MIN_CORRELATION_SAMPLES = 3;

/**
 * Коэффициент ранговой корреляции Спирмена от −1 до 1, либо null.
 *
 * Ранговый, а не Пирсон, по двум причинам. Один крупный донат в обычный вечер
 * у Пирсона перевешивает месяц эфиров, а у рангов он просто «самый большой».
 * И суммы в рангах сравниваются, а не делятся — дробных денег не появляется.
 * null — если пар меньше трёх или одна из величин не меняется: у постоянной
 * величины связи ни с чем нет, а формула поделила бы на ноль.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < MIN_CORRELATION_SAMPLES) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = rx.length;
  const mean = (n + 1) / 2;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = rx[i]! - mean;
    const dy = ry[i]! - mean;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

export type CorrelationStrength = 'none' | 'weak' | 'moderate' | 'strong';

/**
 * Словесная сила связи. Пороги — общепринятые для рангового коэффициента;
 * «нет связи» ниже 0,2 честнее, чем «очень слабая»: на десятке эфиров такое
 * значение не отличить от случайности.
 */
export function correlationStrength(coefficient: number): CorrelationStrength {
  const size = Math.abs(coefficient);
  if (size < 0.2) return 'none';
  if (size < 0.4) return 'weak';
  if (size < 0.7) return 'moderate';
  return 'strong';
}

export interface StreamDayComparison {
  streamDays: number;
  offDays: number;
  /** Средние донаты за день, минорные единицы. null — таких дней не было. */
  donationsPerStreamDay: number | null;
  donationsPerOffDay: number | null;
  /** Средний прирост аудитории за день. null — дней нет или прирост неизвестен. */
  audiencePerStreamDay: number | null;
  audiencePerOffDay: number | null;
}

/**
 * Дни с эфиром против дней без: сколько в среднем приносит день каждого вида.
 *
 * Только для суточных корзин — вопрос «эфир в этот день был?» у часовой корзины
 * не имеет смысла. Последний день обычно неполный, но выкидывать его — значит
 * терять сегодняшний эфир в сводке за неделю; в среднее за много дней он
 * вносит мало.
 */
export function compareStreamDays(buckets: readonly OverviewBucket[]): StreamDayComparison {
  const stream = buckets.filter((bucket) => bucket.liveMinutes > 0);
  const off = buckets.filter((bucket) => bucket.liveMinutes === 0);

  const averageMinor = (days: readonly OverviewBucket[]): number | null =>
    days.length === 0
      ? null
      : divideRounded(
          days.reduce((sum, day) => sum + day.donationsMinor, 0),
          days.length,
        );
  const averageGain = (days: readonly OverviewBucket[]): number | null => {
    const known = days.filter((day) => day.audienceGain !== null);
    return known.length === 0
      ? null
      : divideRounded(
          known.reduce((sum, day) => sum + day.audienceGain!, 0),
          known.length,
        );
  };

  return {
    streamDays: stream.length,
    offDays: off.length,
    donationsPerStreamDay: averageMinor(stream),
    donationsPerOffDay: averageMinor(off),
    audiencePerStreamDay: averageGain(stream),
    audiencePerOffDay: averageGain(off),
  };
}

/**
 * Донаты на час эфира, минорные единицы; null — эфиров не было.
 *
 * Только донаты, пришедшие ВО ВРЕМЯ эфира: донат в среду за вчерашний стрим к
 * этому часу эфира не относится, и деление всех донатов периода на часы в эфире
 * завышало бы цену часа у того, кому платят и вне стримов.
 */
export function donationsPerLiveHour(streams: readonly StreamSession[]): number | null {
  const minutes = streams.reduce((sum, stream) => sum + stream.minutes, 0);
  if (minutes === 0) return null;
  const donations = streams.reduce((sum, stream) => sum + stream.donationsMinor, 0);
  return divideRounded(donations * 60, minutes);
}
