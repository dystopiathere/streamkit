import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  type DonationService,
  type DonationSources,
  donationServiceSchema,
} from '@streamkit/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodQuery, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { DonationSourcesService } from './donation-sources.service';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthStateCookie,
} from './oauth-state-cookie';

const callbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
});

/**
 * Донат-сервисы на странице «Источники».
 *
 * Под `/api/integrations`, а не отдельным ресурсом: на этом пути живёт cookie,
 * которая привязывает OAuth `state` к браузеру (`oauth-state-cookie.ts`), и
 * без неё возврат из DonationAlerts был бы открыт для подмены аккаунта. Три
 * сегмента пути (`donations/<сервис>/…`) не пересекаются с маршрутами площадок
 * аналитики (`<площадка>/…`).
 */
@SkipThrottle({ auth: true })
@Controller('integrations/donations')
export class DonationSourcesController {
  private readonly logger = new Logger(DonationSourcesController.name);

  constructor(
    private readonly sources: DonationSourcesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<DonationSources> {
    return this.sources.list(user.id);
  }

  /** POST: ручка создаёт одноразовый state — GET рано или поздно предзагрузит браузер. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':service/authorize')
  async authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('service', new ZodValidationPipe(donationServiceSchema)) service: DonationService,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthorizeResponse> {
    const { url, state } = await this.sources.buildAuthorizeUrl(user.id, service);
    setOAuthStateCookie(response, state, this.config);
    return { url };
  }

  /**
   * Возврат из сервиса. `@Public()` вынужденно: браузер приходит редиректом со
   * стороннего домена без заголовка авторизации. Аутентифицирует одноразовый
   * state, сверенный с cookie этого браузера.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':service/callback')
  async callback(
    @Param('service', new ZodValidationPipe(donationServiceSchema)) service: DonationService,
    @Query(zodQuery(callbackSchema)) query: z.infer<typeof callbackSchema>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const browserState = readOAuthStateCookie(request);
    clearOAuthStateCookie(response, this.config);

    if (query.error || !query.code || !query.state) {
      response.redirect(this.dashboardUrl(service, 'cancelled'));
      return;
    }

    try {
      await this.sources.completeAuthorization(
        service,
        query.code,
        query.state,
        browserState,
        this.audit.contextFromRequest(request),
      );
      response.redirect(this.dashboardUrl(service, 'connected'));
    } catch (error) {
      // Наружу только факт: кто пришёл, здесь ещё не известно. Причина — в
      // журнал: без этой строки неудачное подключение не оставляло следа нигде,
      // кроме отказа по state, который пишет аудит.
      this.logger.warn({ err: error, service }, 'Подключение донат-сервиса не завершено');
      response.redirect(this.dashboardUrl(service, 'failed'));
    }
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':service')
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('service', new ZodValidationPipe(donationServiceSchema)) service: DonationService,
    @Req() request: Request,
  ): Promise<void> {
    await this.sources.disconnect(user.id, service, this.audit.contextFromRequest(request));
  }

  private dashboardUrl(service: string, status: 'connected' | 'cancelled' | 'failed'): string {
    const base = this.config.webBaseUrl.replace(/\/+$/, '');
    return `${base}/sources?service=${encodeURIComponent(service)}&status=${status}`;
  }
}
