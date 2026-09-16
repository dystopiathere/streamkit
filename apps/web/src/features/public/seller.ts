import { formatMoney, PLAN_PRICES, type SellerInfo } from '@streamkit/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Реквизиты продавца для публичных страниц.
 *
 * С сервера, а не из сборки: это персональные данные владельца, и в репозитории
 * им не место, а менять их — не повод пересобирать дашборд.
 */
export function useSeller() {
  return useQuery({
    queryKey: ['public', 'seller'],
    queryFn: () => api.get<SellerInfo>('/public/seller'),
    staleTime: 60 * 60 * 1000,
  });
}

/** Заглушка на месте незаполненного поля: пустое место прятало бы, что реквизитов нет. */
export const MISSING = '‹не указано›';

/**
 * Подставить реквизиты и цены в текст юридического документа.
 *
 * В файлах документов на их месте стоят метки `{{SELLER_NAME}}` и подобные: сами
 * тексты лежат статикой и открываются по прямой ссылке, а реквизиты живут в
 * окружении сервера. Цены — метками `{{PRICE_MONTH}}` и `{{PRICE_YEAR}}` из
 * `PLAN_PRICES`: вписанные в оферту руками, они разошлись бы с ценой на кнопке.
 */
export function fillDocumentDetails(
  text: string,
  seller: SellerInfo | undefined,
  escape: (value: string) => string = (value) => value,
): string {
  const values: Record<string, string | null | undefined> = {
    SELLER_NAME: seller?.name,
    SELLER_INN: seller?.inn,
    SELLER_EMAIL: seller?.email,
    SELLER_PHONE: seller?.phone,
    PRICE_MONTH: formatMoney(PLAN_PRICES.month),
    PRICE_YEAR: formatMoney(PLAN_PRICES.year),
  };
  return text.replace(/\{\{((?:SELLER|PRICE)_[A-Z]+)\}\}/g, (token, key: string) =>
    key in values ? escape(values[key] ?? MISSING) : token,
  );
}

/**
 * Экранирование значения, подставляемого в Markdown.
 *
 * Реквизиты приходят из окружения сервера, а не от пользователей, но звёздочка
 * или подчёркивание в названии продавца иначе превратились бы в курсив
 * посреди оферты.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>#|~]/g, '\\$&');
}
