/**
 * Английский для сообщений, которые приходят в интерфейс по-русски.
 *
 * Это ошибки API и тексты проверок из схем этого пакета: у схем их показывает
 * форма, у API — уведомление об ошибке. Ключ — сам русский текст, как msgid в
 * gettext. Вести коды ошибок ради второго языка значило бы переписать каждое
 * исключение сервера и каждую схему, а сервер при этом продолжал бы отвечать
 * тем же текстом — только теперь ещё и кодом.
 *
 * Полноту держит тест: он собирает сообщения из исключений API, клиента API в
 * `app-kit` и схем этого пакета и падает и на непереведённое, и на лишнее.
 * Админка сюда не входит — она только на русском.
 */
export const MESSAGES_EN: Readonly<Record<string, string>> = {
  // Вход и сессия
  'Требуется авторизация': 'Please sign in',
  'Недействительный токен': 'Invalid token',
  'Сессия недействительна': 'Your session is no longer valid',
  'Сессия не найдена': 'Session not found',
  'Сессия истекла': 'Your session has expired',
  'Пользователь с таким email уже зарегистрирован': 'A user with this email is already registered',
  'Неверный email или пароль': 'Wrong email or password',
  'Учётная запись недоступна': 'This account is unavailable',
  'Неверный код подтверждения': 'Wrong verification code',
  'Текущий пароль указан неверно': 'The current password is wrong',
  'Новый пароль совпадает с текущим': 'The new password is the same as the current one',
  'Двухфакторная аутентификация уже включена': 'Two-factor authentication is already on',
  'Сначала запросите секрет': 'Request a secret first',
  'Пароль указан неверно': 'Wrong password',
  'Доступ к админке закрыт': 'No access to the admin panel',
  'Минимум 12 символов': 'At least 12 characters',
  'Максимум 128 символов': 'At most 128 characters',
  'Пароль не может состоять из одного символа':
    'The password cannot be a single repeated character',
  'Код из 6 цифр': 'A 6-digit code',
  'Ссылка недействительна или устарела': 'This link is invalid or has expired',
  'Пароли не совпадают': 'The passwords do not match',

  // Общее
  'Ошибка валидации': 'Some fields are filled in incorrectly',
  'Почта не настроена': 'Email is not configured on this server',
  'Нет доступа': 'No access',
  'Сервис временно недоступен, попробуйте ещё раз':
    'The service is temporarily unavailable, please try again',
  'Не удалось выполнить запрос': 'The request failed',
  'Неизвестный часовой пояс': 'Unknown time zone',
  'Ожидается цвет в формате #RRGGBB или #RRGGBBAA': 'Expected a color as #RRGGBB or #RRGGBBAA',
  'Разрешены только https-ссылки': 'Only https links are allowed',

  // Виджеты, события, источники
  'Виджет не найден': 'Widget not found',
  'Токен не найден': 'Link not found',
  'Канал не найден': 'Channel not found',
  'Подпись недействительна': 'Invalid signature',
  'Тело запроса не является JSON': 'The request body is not JSON',
  'Логин канала Twitch: латиница, цифры и подчёркивание':
    'Twitch channel login: Latin letters, digits and underscores',
  'Идентификатор канала YouTube: UC и 22 символа':
    'YouTube channel ID: UC followed by 22 characters',
  'Ник без пробелов, до 64 символов': 'A name without spaces, up to 64 characters',
  'Верхняя граница должна быть не меньше нижней':
    'The upper bound must not be lower than the lower one',
  'Назовите сектор': 'Name the sector',
  'В колесе не больше 24 секторов: для длинных списков есть вертикальная лента':
    'A wheel holds at most 24 sectors: long lists go in the vertical reel',
  'Недопустимый размер страницы': 'Unsupported page size',
  'Для добавления времени нужно указать секунды': 'Specify the seconds to add',
  'Этот сервис сейчас недоступен': 'This service is unavailable right now',
  'Эта площадка сейчас недоступна': 'This platform is unavailable right now',
  'Ссылка подключения недействительна, начните заново':
    'The connection link is no longer valid, please start over',
  'DonationAlerts не настроен на этом сервере': 'DonationAlerts is not configured on this server',
  'Виджет чата показывает чат ваших каналов — сначала подключите Twitch или YouTube в разделе «Аналитика»':
    'The chat widget shows the chat of your own channels — connect Twitch or YouTube in Analytics first',

  // Комнаты
  'Приватные комнаты не настроены на этом сервере':
    'Private rooms are not configured on this server',
  'Комната не найдена': 'Room not found',
  'Приглашение не найдено': 'Invite not found',
  'Приглашение недействительно': 'This invite is no longer valid',
  'В комнате нет свободных мест': 'The room is full',
  'Гость не найден': 'Guest not found',
  'Удалять можно только гостей': 'Only guests can be removed',
  'Адрес LiveKit должен начинаться с ws:// или wss://':
    'The LiveKit address must start with ws:// or wss://',

  // Тариф и оплата
  'Приватные комнаты доступны в тарифе «Про»': 'Private rooms are part of the Pro plan',
  'Платёж не найден': 'Payment not found',
  'Оплата не настроена': 'Payments are not configured',
  'Оплата не настроена на этом сервере': 'Payments are not configured on this server',
  'Подписка уже действует': 'Your subscription is already active',
  'У пользователя действует другой тариф — бесплатные дни продлевают его':
    'The user already has a different active plan — free days extend that plan',
  'Списание по сохранённой карте ещё обрабатывается — попробуйте через несколько минут':
    'A charge to your saved card is still being processed — try again in a few minutes',
  'Оплата сейчас недоступна: платёжный сервис отклонил запрос. Мы уже разбираемся — попробуйте позже.':
    'Payment is unavailable right now: the payment service declined the request. We are looking into it — please try again later.',
  'Платёжный сервис не ответил. Попробуйте ещё раз.':
    'The payment service did not respond. Please try again.',
  'Платёжный сервис не вернул страницу оплаты': 'The payment service did not return a payment page',
  'Подписки нет': 'You have no subscription',
  'Больше виджетов на этом тарифе создать нельзя — платные тарифы без ограничения':
    'Your plan allows no more widgets — paid plans have no limit',
  'Тариф не позволяет подключить ещё одну площадку':
    'Your plan does not allow connecting another platform',
  // Отказы снятия подарочных дней. Действие только для сотрудника, но словарь
  // собирается по файлам, а billing — не админка: пусть перевод будет.
  'Подарочных дней у этой подписки нет': 'This subscription has no gifted days',
  'Подарочные дни уже истекли': 'The gifted days have already expired',
  'Нет сохранённого способа оплаты — оформите подписку заново':
    'No saved payment method — please subscribe again',
  'Подписка закончилась — оформите её заново':
    'Your subscription has ended — please subscribe again',
  'Включение автопродления требует согласия на списания':
    'Turning on auto-renewal requires consent to recurring charges',

  // Согласия
  'Такого документа нет.': 'There is no such document.',
  'Это согласие даётся при оплате тарифа.': 'This consent is given when you pay for the plan.',
  'Это согласие необходимо для работы сервиса. Отозвать его можно, удалив учётную запись.':
    'The service cannot work without this consent. You can withdraw it by deleting your account.',
};

/** Языки интерфейса дашборда. Первый — язык по умолчанию. */
export const LANGUAGES = ['ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Сообщение на языке интерфейса. Непереведённое остаётся как есть: лучше русский, чем пусто. */
export function translateMessage(message: string, language: string): string {
  if (language !== 'en') return message;
  // hasOwn, а не `in`: «constructor» из ответа не должен находить Object.prototype.
  return Object.hasOwn(MESSAGES_EN, message) ? (MESSAGES_EN[message] ?? message) : message;
}
