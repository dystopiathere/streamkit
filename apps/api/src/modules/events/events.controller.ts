import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  type AlertEvent,
  type CursorPagination,
  cursorPaginationSchema,
  type Page,
  type TestEventInput,
  testEventSchema,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { EventsService } from './events.service';
import { WebhookService } from './webhook.service';

// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на обычные ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly webhooks: WebhookService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(cursorPaginationSchema)) query: CursorPagination,
  ): Promise<Page<AlertEvent>> {
    return this.events.list(user.id, query);
  }

  /** Тестовый алерт: проверка настройки виджета без ожидания реального доната. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('test')
  async test(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(testEventSchema)) body: TestEventInput,
  ): Promise<AlertEvent> {
    return this.events.createTestEvent(user.id, body.language);
  }

  /** Выдаёт новый секрет вебхука. Показывается один раз. */
  @Post('webhook/secret')
  async rotateWebhookSecret(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ sourceId: string; secret: string }> {
    return this.webhooks.rotateSecret(user.id);
  }
}

/**
 * Приём внешних событий. Вынесен в отдельный контроллер, потому что это
 * единственный публичный write-эндпоинт в системе, и правила у него свои:
 * никакой сессии, проверка HMAC, защита от повтора, отдельный лимит запросов.
 */
// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на обычные ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':sourceId')
  async receive(
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Req() request: RawBodyRequest<Request>,
    @Body() _body: unknown,
  ): Promise<{ status: 'created' | 'duplicate' }> {
    const result = await this.webhooks.handle(
      sourceId,
      request.rawBody,
      request.headers,
      this.audit.contextFromRequest(request),
    );
    // Дубль — не ошибка: отправитель мог не получить наш ответ и повторить запрос.
    return { status: result.status };
  }
}
