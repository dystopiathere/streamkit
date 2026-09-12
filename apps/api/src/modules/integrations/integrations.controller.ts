import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  type AuthorizeResponse,
  type AvailablePlatform,
  platformSchema,
} from '@streamkit/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodQuery, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { PlatformConnectionService } from './platform-connection.service';

/**
 * Параметры, которые площадка добавляет к адресу возврата.
 *
 * `error` приходит вместо `code`, когда пользователь нажал «Отмена» на экране
 * подтверждения. Это не авария: его надо вернуть в дашборд без подключения, а
 * не показать страницу ошибки.
 */
const callbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
});

// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly connections: PlatformConnectionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Какие площадки доступны в этой инсталляции и какие уже подключены. */
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AvailablePlatform[]> {
    return this.connections.listAvailable(user.id);
  }

  /**
   * Ссылка на вход в площадку.
   *
   * POST, а не GET: ручка не читает состояние, а создаёт одноразовый `state` в
   * Redis. GET с побочным эффектом рано или поздно окажется предзагружен
   * браузером.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':platform/authorize')
  async authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('platform', new ZodValidationPipe(platformSchema)) platform: 'twitch' | 'youtube',
  ): Promise<AuthorizeResponse> {
    return { url: await this.connections.buildAuthorizeUrl(user.id, platform) };
  }

  /**
   * Адрес возврата с площадки.
   *
   * `@Public()` вынужденно: браузер приходит сюда редиректом со стороннего
   * домена, заголовка авторизации в таком запросе нет и быть не может.
   * Единственный аутентификатор — одноразовый `state`, привязанный к
   * пользователю на стороне сервера (см. `OAuthStateService`).
   *
   * Отвечаем редиректом, а не JSON: на этой странице стоит живой человек,
   * пришедший из чужой вкладки, и ему нужен дашборд, а не тело ответа.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':platform/callback')
  async callback(
    @Param('platform', new ZodValidationPipe(platformSchema)) platform: 'twitch' | 'youtube',
    @Query(zodQuery(callbackSchema)) query: z.infer<typeof callbackSchema>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (query.error || !query.code || !query.state) {
      // Пользователь отказался или площадка не дала код — молча возвращаем его
      // в дашборд. Подробности площадки в адресной строке ему ни о чём не скажут.
      response.redirect(this.dashboardUrl(platform, 'cancelled'));
      return;
    }

    try {
      await this.connections.completeAuthorization(
        platform,
        query.code,
        query.state,
        this.audit.contextFromRequest(request),
      );
      response.redirect(this.dashboardUrl(platform, 'connected'));
    } catch {
      // Причина уже в аудите и логах. Наружу — только факт, потому что здесь
      // ещё не известно, кто именно пришёл: state не сошёлся.
      response.redirect(this.dashboardUrl(platform, 'failed'));
    }
  }

  private dashboardUrl(platform: string, status: 'connected' | 'cancelled' | 'failed'): string {
    const base = this.config.webBaseUrl.replace(/\/+$/, '');
    return `${base}/analytics?platform=${encodeURIComponent(platform)}&status=${status}`;
  }
}
