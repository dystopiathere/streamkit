import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Отметку «видели» чаще раза в сутки не двигаем: обновление сессии идёт каждые четверть часа. */
const SEEN_RESOLUTION_MS = 24 * 60 * 60 * 1000;

/**
 * Браузеры, из которых входили в аккаунт (`KnownDevice`).
 */
@Injectable()
export class KnownDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Новая метка браузера — для cookie `sk_device`. */
  issue(): string {
    return this.crypto.generateToken();
  }

  /**
   * Запомнить браузер за аккаунтом.
   *
   * Вставка с `skipDuplicates`, а не «найти, потом создать»: два входа из
   * одного браузера подряд (двойной клик, две вкладки) не должны оба решить,
   * что браузер новый, и прислать два письма.
   *
   * @returns true, если этого браузера у аккаунта раньше не было.
   */
  async remember(
    userId: string,
    deviceId: string,
    userAgent: string | null | undefined,
    now = new Date(),
  ): Promise<boolean> {
    const deviceHash = this.crypto.hashToken(deviceId);
    const { count } = await this.prisma.knownDevice.createMany({
      data: [{ userId, deviceHash, userAgent: userAgent ?? null, createdAt: now, lastSeenAt: now }],
      skipDuplicates: true,
    });
    if (count === 1) return true;

    await this.prisma.knownDevice.updateMany({
      where: {
        userId,
        deviceHash,
        lastSeenAt: { lt: new Date(now.getTime() - SEEN_RESOLUTION_MS) },
      },
      data: { lastSeenAt: now, userAgent: userAgent ?? null },
    });
    return false;
  }
}
