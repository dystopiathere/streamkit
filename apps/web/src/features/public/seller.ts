import { PLAN_PRICES, type SellerInfo } from '@streamkit/contracts';
import { useQuery } from '@tanstack/react-query';
import i18n from 'i18next';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/locale';

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
export function missingValue(): string {
  return i18n.t('public.missing');
}

/**
 * Подставить реквизиты и цены в текст юридического документа.
 *
 * В файлах документов на их месте стоят метки `{{SELLER_NAME}}` и подобные: сами
 * тексты лежат статикой и открываются по прямой ссылке, а реквизиты живут в
 * окружении сервера. Цены — метками вида `{{PRICE_PRO_MONTH}}` из `PLAN_PRICES`:
 * вписанные в оферту руками, они разошлись бы с ценой на кнопке. Метка на
 * каждый тариф и период, потому что тарифов больше одного, и «цена в месяц» без
 * названия тарифа ничего не значит.
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
    PRICE_PRO_MONTH: formatMoney(PLAN_PRICES.pro.month),
    PRICE_PRO_YEAR: formatMoney(PLAN_PRICES.pro.year),
    PRICE_MULTISTREAM_MONTH: formatMoney(PLAN_PRICES.multistream.month),
    PRICE_MULTISTREAM_YEAR: formatMoney(PLAN_PRICES.multistream.year),
  };
  return text.replace(/\{\{((?:SELLER|PRICE)_[A-Z_]+)\}\}/g, (token, key: string) =>
    key in values ? escape(values[key] ?? missingValue()) : token,
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
