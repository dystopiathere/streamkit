/**
 * Почему сотрудник не входит в админку:
 *
 *   node dist/scripts/admin-status.js <email>
 *
 * Вход отвечает одинаково на неверный пароль, неверный код и отсутствие роли —
 * так он не подсказывает, чьи адреса принадлежат сотрудникам. Точная причина
 * пишется в журнал аудита, и этот скрипт её показывает тому, у кого есть доступ
 * к серверу. Печатает только состояние аккаунта и причины отказов — ни хэшей, ни
 * секрета второго фактора.
 */
import { emailSchema } from '@streamkit/contracts';
import { loadEnvFiles } from '../config/env-files';
import { PrismaService } from '../common/prisma/prisma.service';

const REASONS: Record<string, string> = {
  password: 'неверный пароль',
  'not-staff': 'нет роли сотрудника или аккаунт не активен — нужен grant-role.js',
  'totp-missing': 'не включён двухфакторный вход (дашборд → «Приватность»)',
  totp: 'код не подошёл: проверьте, что в приложении запись от последнего включения 2FA',
  'totp-replay': 'код уже использован — дождитесь следующего',
};

async function main(): Promise<void> {
  loadEnvFiles();
  const email = emailSchema.safeParse(process.argv[2]);
  if (!email.success) {
    console.error('Использование: admin-status.js <email>');
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaService();
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.data },
      select: { id: true, role: true, status: true, isTotpEnabled: true },
    });
    if (!user) {
      console.error('Пользователь с такой почтой не найден');
      process.exitCode = 1;
      return;
    }
    console.warn(
      `Роль: ${user.role}; статус: ${user.status}; ` +
        `двухфакторный вход: ${user.isTotpEnabled ? 'включён' : 'выключен'}`,
    );

    const attempts = await prisma.auditLog.findMany({
      where: { userId: user.id, action: { in: ['admin.login.failed', 'admin.login.success'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { action: true, createdAt: true, metadata: true },
    });
    if (attempts.length === 0) console.warn('Попыток входа в админку не было.');
    for (const attempt of attempts) {
      const reason = (attempt.metadata as { reason?: string } | null)?.reason;
      const outcome =
        attempt.action === 'admin.login.success'
          ? 'вход выполнен'
          : `отказ: ${(reason && REASONS[reason]) ?? reason ?? 'причина не записана'}`;
      console.warn(`${attempt.createdAt.toISOString()}  ${outcome}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
