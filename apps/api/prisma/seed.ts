import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { loadEnvFiles } from '../src/config/env-files';
import { hash } from '@node-rs/argon2';
import { alertWidgetConfigSchema } from '@streamkit/contracts';
import { generateSecret, generateURI } from 'otplib';
import { CryptoService } from '../src/common/crypto/crypto.service';
import type { AppConfig } from '../src/config/app-config.service';

/**
 * Наполнение базы для разработки.
 *
 * Скрипт идемпотентен: повторный запуск не плодит дубли, а обновляет
 * существующие записи. Пароль намеренно фиксированный и слабый — этот seed
 * запускается только на локальной машине и в CI.
 */
const DEMO_EMAIL = 'streamer@streamkit.local';
const DEMO_PASSWORD = 'streamkit-demo-password';
const ADMIN_EMAIL = 'admin@streamkit.local';
const ADMIN_PASSWORD = 'streamkit-admin-password';

// Окружение грузится до создания клиента: tsx файлы .env не читает, а сам
// клиент ищет их только в текущем каталоге — то есть в apps/api, где файла
// больше нет. Единственный .env лежит в корне репозитория.
loadEnvFiles(resolve(import.meta.dirname, '..'));

// С Prisma 7 клиент подключается через драйвер-адаптер, а адрес БД приходит
// из окружения, а не из схемы.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

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
  //
  // Ключ — TOKEN_HASH_PEPPER, как в CryptoService.hashToken. Раньше здесь стоял
  // ENCRYPTION_KEY, и ссылка из сида не открывалась: приложение искало хэш,
  // посчитанный другим ключом.
  const rawToken = randomBytes(32).toString('base64url');
  const pepper = process.env.TOKEN_HASH_PEPPER;
  if (!pepper) {
    throw new Error(
      'Нужен TOKEN_HASH_PEPPER: хэш токена считается тем же ключом, что и в приложении',
    );
  }
  const tokenHash = createHmac('sha256', pepper).update(rawToken).digest('hex');

  await prisma.overlayToken.deleteMany({ where: { widgetId: widget.id, label: 'seed' } });
  await prisma.overlayToken.create({
    data: { widgetId: widget.id, tokenHash, label: 'seed' },
  });

  const overlayBase = process.env.OVERLAY_BASE_URL ?? 'http://localhost:5174';
  const admin = await seedAdmin();

  console.log('\nДемо-данные готовы:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  виджет:   ${widget.name} (${widget.id})`);
  console.log(`  оверлей:  ${overlayBase}/?token=${rawToken}\n`);
  console.log('Админка:');
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log(`  TOTP:     ${admin.secret}`);
  console.log(`  otpauth:  ${admin.uri}\n`);
}

/**
 * Сотрудник с ролью ADMIN и включённым вторым фактором: без него в админку не
 * войти. Секрет сохраняется между запусками — приложение-аутентификатор
 * настраивается один раз.
 */
async function seedAdmin(): Promise<{ secret: string; uri: string }> {
  const crypto = new CryptoService({
    encryptionKey: Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64'),
    ipHashPepper: process.env.IP_HASH_PEPPER ?? '',
    tokenHashPepper: process.env.TOKEN_HASH_PEPPER ?? '',
  } as AppConfig);

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  const secret = existing?.totpSecretEncrypted
    ? crypto.decrypt(existing.totpSecretEncrypted)
    : generateSecret();

  const passwordHash = await hash(ADMIN_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const data = {
    passwordHash,
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    isTotpEnabled: true,
    totpSecretEncrypted: crypto.encrypt(secret),
  };
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, displayName: 'Админ', ...data },
    update: data,
  });
  return { secret, uri: generateURI({ issuer: 'StreamKit', label: ADMIN_EMAIL, secret }) };
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
