import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
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
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthStateCookie,
} from './oauth-state-cookie';
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
  private readonly logger = new Logger(IntegrationsController.name);

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
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthorizeResponse> {
    const { url, state } = await this.connections.buildAuthorizeUrl(user.id, platform);
    setOAuthStateCookie(response, state, this.config);
    return { url };
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
    const browserState = readOAuthStateCookie(request);
    // Cookie одноразовая, как и сам state: чем бы ни кончился возврат.
    clearOAuthStateCookie(response, this.config);

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
        browserState,
        this.audit.contextFromRequest(request),
      );
      response.redirect(this.dashboardUrl(platform, 'connected'));
    } catch (error) {
      // Наружу — только факт: здесь ещё не известно, кто именно пришёл. Причина
      // — в журнал: аудит пишет только отказ по state, а сбой обмена кода у
      // площадки иначе не оставлял следа нигде.
      this.logger.warn({ err: error, platform }, 'Подключение площадки не завершено');
      // Лимит тарифа — не сбой: стример сделал всё правильно, просто площадок
      // на его тарифе меньше. Метка своя, и страница объясняет, что делать, а
      // не предлагает «попробовать ещё раз».
      const status = error instanceof ForbiddenException ? 'plan-limit' : 'failed';
      response.redirect(this.dashboardUrl(platform, status));
    }
  }

  private dashboardUrl(
    platform: string,
    status: 'connected' | 'cancelled' | 'failed' | 'plan-limit',
  ): string {
    const base = this.config.webBaseUrl.replace(/\/+$/, '');
    return `${base}/analytics?platform=${encodeURIComponent(platform)}&status=${status}`;
  }
}
