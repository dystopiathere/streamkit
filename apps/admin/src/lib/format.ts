import { formatMoney, type Money } from '@streamkit/contracts';

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const number = new Intl.NumberFormat('ru-RU');

export const formatDateTime = (value: string | null): string =>
  value ? dateTime.format(new Date(value)) : '—';
export const formatDate = (value: string | null): string =>
  value ? date.format(new Date(value)) : '—';
export const formatNumber = (value: number): string => number.format(value);

/** Суммы по валютам одной строкой: «4 083 ₽». Пустой список — прочерк. */
export function formatMoneyList(list: Money[]): string {
  return list.length > 0 ? list.map((money) => formatMoney(money)).join(' · ') : '—';
}
