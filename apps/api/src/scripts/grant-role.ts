/**
 * Назначить роль сотрудника без админки:
 *
 *   node dist/scripts/grant-role.js <email> <user|support|admin>
 *
 * Нужен ровно для первого админа: выдать роль через интерфейс некому, пока
 * админа нет. Дальше роли выдаются в админке. Запись попадает в журнал с
 * пометкой источника — роль, выданная мимо интерфейса, не должна быть
 * невидимой.
 */
import { emailSchema, userRoleSchema } from '@streamkit/contracts';
import { loadEnvFiles } from '../config/env-files';
import { PrismaService } from '../common/prisma/prisma.service';
import { toPrismaRole } from '../modules/admin/admin.mappers';

async function main(): Promise<void> {
  loadEnvFiles();
  const [, , rawEmail, rawRole] = process.argv;
  const email = emailSchema.safeParse(rawEmail);
  const role = userRoleSchema.safeParse(rawRole);
  if (!email.success || !role.success) {
    console.error('Использование: grant-role.js <email> <user|support|admin>');
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
    const next = toPrismaRole(role.data);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { role: next } }),
      prisma.auditLog.create({
        data: {
          action: 'admin.role.changed',
          userId: user.id,
          metadata: { from: user.role.toLowerCase(), to: role.data, source: 'cli' },
        },
      }),
      ...(next === 'USER'
        ? [
            prisma.refreshToken.updateMany({
              where: { userId: user.id, scope: 'ADMIN', revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    console.warn(`Роль ${role.data} назначена.`);
    if (next !== 'USER' && !user.isTotpEnabled) {
      console.warn('Вход в админку откроется после включения двухфакторного входа в дашборде.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
