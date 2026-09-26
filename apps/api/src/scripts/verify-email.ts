/**
 * Отметить почту подтверждённой без письма:
 *
 *   node dist/scripts/verify-email.js <email>
 *
 * Для случаев, когда письму дойти не до чего: первый вход владельца на свежем
 * сервере, где домен почты ещё не прошёл проверку у Postbox, и сквозной прогон,
 * у которого почты нет вовсе. Запись попадает в журнал с пометкой источника —
 * подтверждение мимо ссылки не должно быть невидимым.
 */
import { emailSchema } from '@streamkit/contracts';
import { loadEnvFiles } from '../config/env-files';
import { PrismaService } from '../common/prisma/prisma.service';

async function main(): Promise<void> {
  loadEnvFiles();
  const email = emailSchema.safeParse(process.argv[2]);
  if (!email.success) {
    console.error('Использование: verify-email.js <email>');
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaService();
  try {
    const user = await prisma.user.findUnique({ where: { email: email.data } });
    if (!user || user.status === 'ANONYMIZED') {
      console.error('Пользователь не найден: сначала зарегистрируйтесь в дашборде');
      process.exitCode = 1;
      return;
    }
    if (user.emailVerifiedAt) {
      console.warn('Почта уже подтверждена.');
      return;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      prisma.auditLog.create({
        data: { action: 'auth.email.verified', userId: user.id, metadata: { source: 'cli' } },
      }),
    ]);
    console.warn('Почта подтверждена.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
