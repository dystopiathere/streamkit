import { Injectable, Logger } from '@nestjs/common';
import type { AvailablePlatform, Platform } from '@streamkit/contracts';
import { AppConfig } from '../../config/app-config.service';
import type { PlatformProvider } from './platform-provider';
import { KickProvider } from './kick.provider';
import { TwitchProvider } from './twitch.provider';
import { YouTubeProvider } from './youtube.provider';

/**
 * Реестр площадок.
 *
 * Провайдер попадает сюда только если его приложение настроено — заданы client
 * id и secret. Без этого площадка не предлагается к подключению вовсе: лучше
 * отсутствующая кнопка, чем кнопка, которая уводит на страницу ошибки Twitch.
 *
 * Новая площадка = новый класс по `PlatformProvider` плюс строчка в
 * конструкторе. Ничего другого трогать не нужно.
 */
@Injectable()
export class PlatformRegistry {
  private readonly logger = new Logger(PlatformRegistry.name);
  private readonly providers = new Map<Platform, PlatformProvider>();
  private readonly all: PlatformProvider[];

  constructor(
    private readonly config: AppConfig,
    twitch: TwitchProvider,
    youtube: YouTubeProvider,
    kick: KickProvider,
  ) {
    this.all = [twitch, youtube, kick];

    for (const provider of this.all) {
      if (this.config.oauthCredentials(provider.platform)) {
        this.providers.set(provider.platform, provider);
      } else {
        this.logger.log(
          { platform: provider.platform },
          'Площадка не настроена, подключение недоступно',
        );
      }
    }
  }

  /** Провайдер настроенной площадки, либо null. */
  find(platform: Platform): PlatformProvider | null {
    return this.providers.get(platform) ?? null;
  }

  /**
   * Провайдер или исключение. Отдельный метод, чтобы вызывающий код не сыпал
   * одинаковыми проверками на null там, где отсутствие площадки — это ошибка.
   */
  require(platform: Platform): PlatformProvider {
    const provider = this.find(platform);
    if (!provider) {
      throw new Error(`Площадка ${platform} не настроена`);
    }
    return provider;
  }

  /** Что показать в интерфейсе: все известные площадки с признаком готовности. */
  list(connected: ReadonlySet<Platform>): AvailablePlatform[] {
    return this.all.map((provider) => ({
      platform: provider.platform,
      title: provider.title,
      isConfigured: this.providers.has(provider.platform),
      isConnected: connected.has(provider.platform),
    }));
  }
}
