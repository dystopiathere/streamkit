import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { RealtimeBus } from './bus/realtime-bus.service';
import { CryptoService } from './crypto/crypto.service';
import { PasswordService } from './crypto/password.service';
import { RedisLock } from './redis/lock.service';

/**
 * Инфраструктурные сервисы без бизнес-смысла: шифрование, хэширование паролей,
 * аудит. Глобальный модуль — чтобы не импортировать его в каждый доменный.
 */
@Global()
@Module({
  providers: [CryptoService, PasswordService, AuditService, RealtimeBus, RedisLock],
  exports: [CryptoService, PasswordService, AuditService, RealtimeBus, RedisLock],
})
export class CommonModule {}
