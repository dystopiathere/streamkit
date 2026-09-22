import { type AlertEvent, formatMoney } from '@streamkit/contracts';

/** Переменные, которые выделяются цветом акцента: на них смотрит зритель. */
const HIGHLIGHTED_VARS = new Set(['username', 'amount', 'count']);

/**
 * Переменные шаблона из события — одни для оповещения и последнего события,
 * чтобы `{amount}` в двух виджетах одного стримера не выглядел по-разному.
 */
export function templateVars(
  event: Pick<AlertEvent, 'username' | 'message' | 'amount' | 'count' | 'type'>,
): Record<string, string> {
  return {
    username: event.username,
    amount: event.amount ? formatMoney(event.amount) : '',
    // Количество — биты, зрители рейда, месяцы, подарки — числом с разрядами:
    // «10 000 битов» читается, «10000» — нет.
    count: event.count === null ? '' : new Intl.NumberFormat('ru-RU').format(event.count),
    message: event.message,
    type: event.type,
  };
}

/**
 * Разбирает шаблон на части и подсвечивает имя донатера и сумму.
 *
 * Подстановка идёт по кускам шаблона, а не по готовой строке: если сначала
 * собрать текст, а потом искать в нём имя, то донатер с ником вроде «задонатил»
 * сломает разметку, а ник, совпадающий с частью шаблона, подсветит не то.
 */
export function renderHighlighted(
  template: string,
  vars: Record<string, string>,
  highlightColor: string,
): React.JSX.Element[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const match = /^\{(\w+)\}$/.exec(part);
    const key = match?.[1];

    if (!key || vars[key] === undefined) {
      // Неизвестный плейсхолдер остаётся видимым текстом — пользователю проще
      // заметить опечатку в шаблоне, чем гадать, куда исчез кусок строки.
      return <span key={index}>{part}</span>;
    }

    return (
      <span key={index} style={HIGHLIGHTED_VARS.has(key) ? { color: highlightColor } : undefined}>
        {vars[key]}
      </span>
    );
  });
}
