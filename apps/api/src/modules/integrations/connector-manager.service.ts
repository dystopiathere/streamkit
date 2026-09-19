import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { IncomingAlertEvent } from '@streamkit/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import type { DonationConnector } from './donation-provider';
import { DonationAlertsConnector } from './donationalerts.connector';
import { PlatformTokenService, type CredentialProvider } from './platform-token.service';
import { TwitchEventSubConnector } from './twitch-eventsub.connector';

/**
 * Как часто воркер сверяет живые соединения с источниками в БД.
 *
 * Стример подключил DonationAlerts и ждёт донат сейчас, а не после деплоя:
 * раньше коннекторы поднимались один раз на старте, и новый источник начинал
 * работать только с перезапуском воркера. Команд воркеру в проекте нет, и
 * лёгкий запрос раз в десять секунд дешевле, чем заводить их ради сверки.
 */
export const CONNECTOR_TICK_MS = 10_000;

/** Донат-сервисы с живым соединением. Вебхук сюда не входит: он приходит к нам сам. */
const CONNECTED_PROVIDERS = ['DONATIONALERTS'] as const;

interface WantedConnection {
  userId: string;
  provider: string;
  accountId: string | null;
}

/**
 * Менеджер живых подключений к донат-сервисам.
 *
 * Держит по соединению на включённый источник: поднимает новые, закрывает
 * отключённые, выключает источник с причиной, когда доступ потерян. Один
 * упавший коннектор не утаскивает за собой остальные.
 *
 * Аренды на кластер здесь нет, в отличие от чата, — и это осознанно: две
 * реплики воркера получат один донат дважды, и дубль отбросит дедупликация по
 * идентификатору события. Пропущенный донат не восстановится, а дубль ничего
 * не стоит.
 */
@Injectable()
export class ConnectorManager implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectorManager.name);
  private readonly connectors = new Map<string, DonationConnector>();
  /**
   * Активные подключения. Ключ включает аккаунт у сервиса: стример, подключивший
   * другой аккаунт, получает новое соединение, а не старое, слушающее прежний.
   */
  private readonly active = new Map<
    string,
    { userId: string; provider: string; stop: () => Promise<void> }
  >();
  private reconciling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
    private readonly events: EventsService,
    donationAlerts: DonationAlertsConnector,
    twitch: TwitchEventSubConnector,
  ) {
    this.connectors.set(donationAlerts.provider, donationAlerts);
    this.connectors.set(twitch.provider, twitch);
  }

  /** Первая сверка — сразу при старте, не дожидаясь такта. Старт процесса она не держит. */
  onApplicationBootstrap(): void {
    void this.reconcile().catch((error: unknown) =>
      this.logger.error({ err: error }, 'Сверка источников донатов не выполнена'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((entry) => entry.stop()));
    this.active.clear();
  }

  /** Сколько соединений держит процесс. Для тестов и журнала. */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Свести живые соединения с включёнными источниками.
   *
   * Такт не перекрывается сам с собой: старт соединения ходит в сеть, и второй
   * такт, начатый поверх первого, поднял бы то же соединение дважды.
   */
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const wanted = await this.wanted();

      for (const key of [...this.active.keys()]) {
        if (!wanted.has(key)) await this.stopKey(key);
      }
      for (const [key, source] of wanted) {
        if (this.active.has(key)) continue;
        await this.start(key, source).catch((error: unknown) => {
          this.logger.error(
            { err: error, userId: source.userId, provider: source.provider },
            'Не удалось подключить источник',
          );
        });
      }
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Что должно быть подключено: включённые донат-сервисы и каналы Twitch,
   * доступ к которым жив. Twitch подключён ради аналитики, и события канала
   * идут вместе с ним — отдельного включения у них нет.
   */
  private async wanted(): Promise<Map<string, WantedConnection>> {
    const [sources, channels] = await Promise.all([
      this.prisma.donationSource.findMany({
        where: { isEnabled: true, provider: { in: [...CONNECTED_PROVIDERS] } },
        select: { userId: true, provider: true, externalAccountId: true },
      }),
      this.prisma.channel.findMany({
        where: { platform: 'TWITCH', isEnabled: true, syncState: { not: 'AUTH_EXPIRED' } },
        select: { userId: true, externalId: true },
      }),
    ]);
    const all: WantedConnection[] = [
      ...sources.map((source) => ({
        userId: source.userId,
        provider: source.provider.toLowerCase(),
        accountId: source.externalAccountId,
      })),
      ...channels.map((channel) => ({
        userId: channel.userId,
        provider: 'twitch',
        accountId: channel.externalId,
      })),
    ];
    return new Map(
      all.map((entry) => [`${entry.userId}:${entry.provider}:${entry.accountId ?? ''}`, entry]),
    );
  }

  private async start(
    key: string,
    { userId, provider, accountId }: WantedConnection,
  ): Promise<void> {
    const connector = this.connectors.get(provider);
    if (!connector) {
      this.logger.warn({ provider }, 'Коннектор не зарегистрирован');
      return;
    }

    const stop = await connector.connect({
      userId,
      accountId,
      // Токен — через общий сервис: тот проверяет срок и продлевает доступ.
      // Раньше коннектор получал токен один раз, и протухший молча уезжал в
      // сервис, а источник умирал, оставаясь «включённым» в дашборде.
      getAccessToken: () => this.tokens.getAccessToken(userId, provider as CredentialProvider),
      emit: async (event: IncomingAlertEvent) => {
        await this.events.ingest(event);
      },
      reportFailure: (reason) => {
        this.logger.warn({ userId, provider, reason }, 'Сбой соединения с донат-сервисом');
      },
      onAccessLost: (reason) => {
        void this.disable(userId, provider, reason);
      },
    });

    this.active.set(key, { userId, provider, stop });
    this.logger.log({ userId, provider }, 'Источник донатов подключён');
  }

  /**
   * Источник с мёртвым доступом выключается, а не остаётся «включённым».
   *
   * Иначе он переподключался бы на каждом такте, каждый раз получал бы 401 —
   * и в дашборде выглядел бы рабочим. Причину видит стример на странице
   * «Источники»; чинится повторным подключением.
   */
  private async disable(userId: string, provider: string, reason: string): Promise<void> {
    this.logger.warn({ userId, provider, reason }, 'Доступ к донат-сервису потерян');
    for (const [key, entry] of [...this.active]) {
      if (entry.userId === userId && entry.provider === provider) await this.stopKey(key);
    }
    // У Twitch источник — канал «Аналитики»: мёртвый доступ там тот же, что
    // видит опрос метрик, и чинится тем же повторным подключением.
    const disabled =
      provider === 'twitch'
        ? this.prisma.channel.updateMany({
            where: { userId, platform: 'TWITCH' },
            data: { syncState: 'AUTH_EXPIRED', syncError: reason },
          })
        : this.prisma.donationSource.updateMany({
            where: { userId, provider: provider.toUpperCase() as never, isEnabled: true },
            data: { isEnabled: false, disabledReason: reason },
          });
    await disabled.catch((error: unknown) =>
      this.logger.error({ err: error, userId, provider }, 'Источник не выключен'),
    );
  }

  private async stopKey(key: string): Promise<void> {
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    await entry.stop().catch(() => undefined);
  }
}

/**
 * Такт сверки — отдельным классом, как у чата и опроса аналитики: так его
 * можно вызвать из теста, не дожидаясь таймера. Живёт только в воркере: в API
 * `ScheduleModule` не поднят.
 */
@Injectable()
export class ConnectorScheduler {
  private readonly logger = new Logger(ConnectorScheduler.name);

  constructor(private readonly manager: ConnectorManager) {}

  @Interval(CONNECTOR_TICK_MS)
  async tick(): Promise<void> {
    try {
      await this.manager.reconcile();
    } catch (error) {
      this.logger.error({ err: error }, 'Сверка источников донатов не выполнена');
    }
  }
}
