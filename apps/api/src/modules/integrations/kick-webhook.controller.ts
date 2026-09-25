import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { Public } from '../../common/auth/auth.decorators';
import { KickWebhookService } from './kick-webhook.service';

/**
 * Вебхуки Kick: оповещения, начало и конец эфира и чат всех подключённых
 * каналов — на один адрес, который задаётся в настройках приложения Kick.
 *
 * Без лимита запросов, и лимитеры перечислены ОБА: события всех стримеров идут
 * с нескольких адресов Kick, и строки чата одного оживлённого канала упёрлись
 * бы в лимит на IP за секунды. `@SkipThrottle()` без аргументов снял бы только
 * `default` (см. вебхук LiveKit). Защита здесь — подпись, а не частота.
 *
 * Ответы: 401 — подпись не наша; 200 — принято или не нужно; 5xx — наш сбой,
 * и Kick повторит доставку. Kick отписывает приложение от события, которое
 * сутки не удаётся доставить, поэтому «не нужно» — это 200, а не ошибка.
 */
@SkipThrottle({ default: true, auth: true })
@Controller('integrations/kick')
export class KickWebhookController {
  constructor(
    private readonly webhooks: KickWebhookService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RawBodyRequest<Request>): Promise<{ status: string }> {
    const result = await this.webhooks.handle(request.rawBody, request.headers);
    if (result === 'invalid') {
      await this.audit.record('webhook.signature.invalid', null, {
        ...this.audit.contextFromRequest(request),
        metadata: { source: 'kick' },
      });
      throw new UnauthorizedException();
    }
    return { status: result };
  }
}
