import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { IncomingAlertEvent } from '@streamkit/contracts';
import { PlatformAuthError } from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import type { DonationConnector } from './donation-provider';
import { DonationAlertsConnector } from './donationalerts.connector';
import { PlatformTokenService, type CredentialProvider } from './platform-token.service';

/**
 * Менеджер живых подключений к площадкам.
 *
 * Отвечает за жизненный цикл: поднять коннекторы для включённых источников при
 * старте, остановить их при завершении процесса, не дать одному упавшему
 * коннектору утащить за собой остальные.
 */
@Injectable()
export class ConnectorManager implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectorManager.name);
  private readonly connectors = new Map<string, DonationConnector>();
  /** Активные подключения: ключ — `${userId}:${provider}`. */
  private readonly active = new Map<string, () => Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
    private readonly events: EventsService,
    donationAlerts: DonationAlertsConnector,
  ) {
    this.connectors.set(donationAlerts.provider, donationAlerts);
  }

  async onModuleInit(): Promise<void> {
    await this.startAll();
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((stop) => stop()));
    this.active.clear();
  }

  /**
   * Поднимает подключения для всех включённых источников.
   *
   * Каждый коннектор стартует изолированно: если у одного пользователя протух
   * токен, это не должно оставить без алертов всех остальных.
   */
  async startAll(): Promise<void> {
    const sources = await this.prisma.donationSource.findMany({
      where: { isEnabled: true, provider: { in: ['DONATIONALERTS', 'DONATEPAY'] } },
    });

    for (const source of sources) {
      await this.start(source.userId, source.provider.toLowerCase()).catch((error: unknown) => {
        this.logger.error(
          { err: error, userId: source.userId, provider: source.provider },
          'Не удалось подключить источник',
        );
      });
    }

    this.logger.log({ count: this.active.size }, 'Коннекторы запущены');
  }

  async start(userId: string, provider: string): Promise<void> {
    const connector = this.connectors.get(provider);
    if (!connector) {
      this.logger.warn({ provider }, 'Коннектор не зарегистрирован');
      return;
    }

    const key = `${userId}:${provider}`;
    // Повторный запуск без остановки оставил бы два соединения и удвоил алерты.
    await this.stop(userId, provider);

    // Токен берётся через общий сервис, а не расшифровывается здесь: тот
    // проверяет срок и обновляет при необходимости. Раньше `expiresAt` не
    // смотрели вовсе — протухший токен уезжал в коннектор, площадка отвечала
    // 401, и источник молча умирал, оставаясь «включённым» в дашборде.
    let accessToken: string;
    try {
      accessToken = await this.tokens.getAccessToken(userId, provider as CredentialProvider);
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        await this.disable(userId, provider);
        this.logger.warn({ userId, provider }, 'Доступ к площадке истёк, источник выключен');
        return;
      }
      throw error;
    }

    const stop = await connector.connect({
      userId,
      accessToken,
      emit: async (event: IncomingAlertEvent) => {
        await this.events.ingest(event);
      },
      reportFailure: (reason) => {
        this.logger.warn({ userId, provider, reason }, 'Сбой соединения с площадкой');
      },
    });

    this.active.set(key, stop);
  }

  /**
   * Источник с мёртвым доступом выключается, а не остаётся «включённым».
   *
   * Иначе он переподключается при каждом старте воркера, каждый раз получает
   * 401 — и в дашборде при этом выглядит рабочим.
   */
  private async disable(userId: string, provider: string): Promise<void> {
    await this.prisma.donationSource
      .updateMany({
        where: { userId, provider: provider.toUpperCase() as never },
        data: { isEnabled: false },
      })
      .catch(() => undefined);
  }

  async stop(userId: string, provider: string): Promise<void> {
    const key = `${userId}:${provider}`;
    const stop = this.active.get(key);
    if (!stop) return;

    await stop().catch(() => undefined);
    this.active.delete(key);
  }
}
