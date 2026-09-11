import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Public } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Две разные проверки, потому что у них разные потребители.
 *
 * `/healthz` — «процесс жив»: по нему оркестратор решает, перезапускать ли контейнер.
 * Зависимости он не трогает: если упал Postgres, перезапуск API ничему не поможет,
 * а вот перезапускать все инстансы разом — сделает хуже.
 *
 * `/readyz` — «готов принимать трафик»: проверяет зависимости, и при их недоступности
 * инстанс выводится из балансировки, оставаясь живым.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('healthz')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async ready(): Promise<{ status: 'ok'; checks: Record<string, 'ok'> }> {
    const [database, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const failed: string[] = [];
    if (database.status === 'rejected') failed.push('database');
    if (redis.status === 'rejected') failed.push('redis');

    if (failed.length > 0) {
      throw new ServiceUnavailableException({ status: 'degraded', failed });
    }

    return { status: 'ok', checks: { database: 'ok', redis: 'ok' } };
  }
}
