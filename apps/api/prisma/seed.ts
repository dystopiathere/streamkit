import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadEnvFiles } from '../src/config/env-files';
import { hash } from '@node-rs/argon2';
import { alertWidgetConfigSchema } from '@streamkit/contracts';

/**
 * Наполнение базы для разработки.
 *
 * Скрипт идемпотентен: повторный запуск не плодит дубли, а обновляет
 * существующие записи. Пароль намеренно фиксированный и слабый — этот seed
 * запускается только на локальной машине и в CI.
 */
const DEMO_EMAIL = 'streamer@streamkit.local';
const DEMO_PASSWORD = 'streamkit-demo-password';

// Окружение грузится до создания клиента: tsx файлы .env не читает, а сам
// клиент ищет их только в текущем каталоге — то есть в apps/api, где файла
// больше нет. Единственный .env лежит в корне репозитория.
loadEnvFiles(resolve(import.meta.dirname, '..'));

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed не предназначен для production');
  }

  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, passwordHash, displayName: 'Демо-стример' },
    update: { passwordHash },
  });

  await prisma.consent.deleteMany({ where: { userId: user.id } });
  await prisma.consent.createMany({
    data: (['TERMS', 'PRIVACY', 'PERSONAL_DATA'] as const).map((document) => ({
      userId: user.id,
      document,
      documentVersion: '2026-09-11',
    })),
  });

  const existingWidget = await prisma.widget.findFirst({ where: { userId: user.id } });
  const widget =
    existingWidget ??
    (await prisma.widget.create({
      data: {
        userId: user.id,
        type: 'ALERTS',
        name: 'Алерты донатов',
        config: alertWidgetConfigSchema.parse({}) as never,
      },
    }));

  // Токен генерируется здесь, а в базу кладётся только его хэш — ровно так же,
  // как это делает приложение. Значение печатается в консоль один раз: seed не
  // должен создавать привычку хранить токены в открытом виде.
  const rawToken = randomBytes(32).toString('base64url');
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('Нужен ENCRYPTION_KEY: хэш токена считается тем же ключом, что и в приложении');
  }

  const tokenHash = createHmac('sha256', Buffer.from(encryptionKey, 'base64'))
    .update(rawToken)
    .digest('hex');

  await prisma.overlayToken.deleteMany({ where: { widgetId: widget.id, label: 'seed' } });
  await prisma.overlayToken.create({
    data: { widgetId: widget.id, tokenHash, label: 'seed' },
  });

  const overlayBase = process.env.OVERLAY_BASE_URL ?? 'http://localhost:5174';

  console.log('\nДемо-данные готовы:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  виджет:   ${widget.name} (${widget.id})`);
  console.log(`  оверлей:  ${overlayBase}/?token=${rawToken}\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
