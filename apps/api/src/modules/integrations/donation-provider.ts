import type { IncomingAlertEvent } from '@streamkit/contracts';

/**
 * Контракт коннектора донат-площадки.
 *
 * Ядро (приём, дедупликация, рассылка) не знает ни одного провайдера по имени —
 * иначе добавление DonatePay или Boosty превращалось бы в правки в десяти местах.
 * Новый источник = новый класс, реализующий этот интерфейс, и запись в реестре.
 *
 * Коннектор обязан:
 *  - вернуть событие в нормализованном виде (`IncomingAlertEvent`);
 *  - проставить стабильный `externalId`. Если провайдер не даёт идентификатора,
 *    коннектор собирает его сам из неизменяемых полей — без этого не работает
 *    дедупликация, и при переподключении зрители увидят старые алерты заново.
 */
export interface DonationConnector {
  /** Идентификатор провайдера, совпадает со значением в контрактах. */
  readonly provider: 'donationalerts' | 'donatepay';

  /**
   * Открывает подключение для конкретного пользователя.
   * @returns функция остановки; вызывается при отключении источника и при завершении процесса.
   */
  connect(context: ConnectorContext): Promise<() => Promise<void>>;
}

export interface ConnectorContext {
  userId: string;
  /** Расшифрованный access-токен пользователя к API провайдера. */
  accessToken: string;
  /** Коннектор вызывает это на каждое входящее событие. */
  emit: (event: IncomingAlertEvent) => Promise<void>;
  /** Сообщение о проблеме соединения: попадёт в логи и в дашборд. */
  reportFailure: (reason: string) => void;
}

/** OAuth-параметры провайдера: нужны и для ссылки авторизации, и для обмена кода. */
export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}
