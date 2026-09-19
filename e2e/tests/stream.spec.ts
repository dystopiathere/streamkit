import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';

/**
 * Окно эфира в настоящем браузере.
 *
 * Воркера в сквозном прогоне нет, поэтому сообщение чата кладётся в шину
 * напрямую — как в сценарии чата оверлея. Проверяется то, чего не видит
 * интеграционный тест: окно само подписывается на чат своего канала, ссылка
 * OBS, открытая в соседней вкладке, отмечается «в OBS», а донат, пришедший,
 * пока окно открыто, появляется в нём без перезагрузки.
 */
test('окно эфира показывает чат канала, виджеты в OBS и новые события', async ({
  page,
  context,
}) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Эфир');
  await page.getByLabel('Электронная почта').fill(`e2e-stream-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  await page.getByRole('button', { name: 'Только необходимые' }).click();

  await test.step('без площадок и чата окно объясняет, что подключить', async () => {
    await page.getByRole('link', { name: 'Эфир', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Эфир', level: 1 })).toBeVisible();
    await expect(page.getByText(/Подключите Twitch или YouTube/)).toBeVisible();
    await expect(page.getByText(/Чата нет/)).toBeVisible();
  });

  const channel = `e2e_stream_${Date.now()}`;

  await test.step('виджет чата с каналом и оверлей алертов, открытый «в OBS»', async () => {
    await page.getByRole('link', { name: 'Виджеты', exact: true }).click();
    await page.getByPlaceholder('Название виджета').fill('Чат');
    await page.getByLabel('Тип виджета').selectOption('chat');
    await page.getByRole('button', { name: 'Новый виджет' }).click();
    await page.getByRole('link', { name: 'Настроить' }).first().click();
    await page.getByLabel('Канал Twitch').fill(channel);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/api/widgets/'),
    );
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    expect((await saved).ok()).toBe(true);

    await page.getByRole('link', { name: 'Виджеты', exact: true }).click();
    await page.getByPlaceholder('Название виджета').fill('Алерты');
    await page.getByRole('button', { name: 'Новый виджет' }).click();
    await page.getByRole('link', { name: 'Настроить «Алерты»' }).click();
    await page.getByRole('button', { name: 'Создать ссылку' }).click();
    const field = page.locator('input[readonly]').first();
    await expect(field).toHaveValue(/token=/, { timeout: 10_000 });

    const overlay = await context.newPage();
    await overlay.goto(await field.inputValue());
    await page.bringToFront();
  });

  await test.step('окно видит канал из виджета и оверлей в OBS', async () => {
    await page.getByRole('link', { name: 'Эфир', exact: true }).click();
    await expect(page.getByText(`twitch.tv/${channel} — канал из виджета чата`)).toBeVisible();

    const widgets = page.getByRole('region', { name: 'Виджеты' });
    await expect(
      widgets.getByRole('listitem').filter({ hasText: 'Алерты' }).getByText('в OBS'),
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('сообщение чата канала доходит до окна', async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const chatLog = page.getByRole('log', { name: 'Сообщения чата' });
    try {
      // Подписка окна идёт сокетом после загрузки: публикуем, пока не дойдёт.
      await expect
        .poll(
          async () => {
            await redis.publish(
              'streamkit:realtime',
              JSON.stringify({
                kind: 'chat',
                message: {
                  id: `e2e-${Date.now()}`,
                  platform: 'twitch',
                  channel,
                  login: 'viewer',
                  username: 'Зритель окна',
                  color: null,
                  badges: [],
                  parts: [{ kind: 'text', value: 'привет из чата эфира' }],
                  sentAt: new Date().toISOString(),
                },
              }),
            );
            return chatLog.getByText('привет из чата эфира').count();
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      redis.disconnect();
    }
    await expect(chatLog.getByText('Зритель окна').first()).toBeVisible();
  });

  await test.step('донат, пришедший при открытом окне, виден без перезагрузки', async () => {
    const other = await context.newPage();
    await other.goto('/widgets');
    await other.getByRole('button', { name: 'Тестовый алерт' }).click();
    await expect(other.getByText('Тестовый алерт отправлен')).toBeVisible();
    await other.close();

    const events = page.getByRole('region', { name: 'Последние события' });
    await expect(events.getByText('Тестовый зритель')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('отдельное окно без меню', async () => {
    await page.goto('/stream/window');
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0);
    await expect(page.getByRole('log', { name: 'Сообщения чата' })).toBeVisible();
  });
});
