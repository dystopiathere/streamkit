import { CURRENCIES, type Currency } from '@streamkit/contracts';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Основная валюта донатов владельца — в ней считают цель, таймер, топ и
 * сводка аналитики.
 *
 * Валюту не выбирает стример: она приходит с событием. Сложить рубли с
 * долларами нельзя, а курс мы не считаем, поэтому берётся валюта, в которой
 * донатов больше всего. Пока донатов нет — рубли: аудитория сервиса
 * русскоязычная.
 *
 * Считается по всей истории, а не за период: иначе один долларовый донат в
 * тихую неделю переключал бы цель на доллары прямо посреди сбора, а графики
 * аналитики — от диапазона к диапазону.
 *
 * Функция, а не метод сервиса: её спрашивают и виджеты, и аналитика, а
 * модулям незачем импортировать друг друга ради одного запроса.
 */
export async function findPrimaryCurrency(
  prisma: PrismaService,
  userId: string,
): Promise<Currency> {
  const rows = await prisma.alertEvent.groupBy({
    by: ['currency'],
    where: { userId, isTest: false, currency: { not: null } },
    _count: { _all: true },
    // Вторая сортировка — по коду: при равенстве валюта не должна
    // переключаться от запроса к запросу.
    orderBy: [{ _count: { currency: 'desc' } }, { currency: 'asc' }],
    take: 1,
  });
  const currency = rows[0]?.currency;
  return currency && (CURRENCIES as readonly string[]).includes(currency)
    ? (currency as Currency)
    : 'RUB';
}
