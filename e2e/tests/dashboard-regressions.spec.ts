import { expect, test, type Page } from '@playwright/test';
import { Redis } from 'ioredis';

/**
 * Три бага, найденные владельцем вручную, — каждый воспроизведён до исправления.
 *
 * Все три прошли мимо прежних тестов по одной причине: тест проверял шаг, а
 * пользователь шёл путём. Лента событий обновлялась, пока открыта сама; чат
 * доезжал, если канал вписан до открытия оверлея; согласие сохранялось в том
 * хранилище, которое баннер и читает.
 */
async function registerStreamer(page: Page, prefix: string): Promise<void> {
  await page.goto('/register');
  await fillRegistration(page, prefix);
}

async function fillRegistration(page: Page, prefix: string): Promise<void> {
  await page.getByLabel('Отображаемое имя').fill('E2E Регрессии');
  await page.getByLabel('Электронная почта').fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
}

async function dismissBanner(page: Page): Promise<void> {
  const banner = page.getByRole('button', { name: 'Только необходимые' });
  await banner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await banner.isVisible()) await banner.click();
}

test('тестовый алерт с вкладки виджетов виден во вкладке событий без перезагрузки', async ({
  page,
}) => {
  await registerStreamer(page, 'e2e-events');
  await dismissBanner(page);

  // Сначала открываем события: история попадает в кэш как «свежая».
  await page.getByRole('link', { name: 'События' }).click();
  await expect(page.getByRole('heading', { name: 'События' })).toBeVisible();

  // Алерт отправляется с ДРУГОЙ вкладки — ровно так, как устроен интерфейс:
  // кнопка «Тестовый алерт» живёт на странице виджетов.
  await page.getByRole('link', { name: 'Виджеты' }).click();
  await page.getByRole('button', { name: 'Тестовый алерт' }).click();
  await expect(page.getByText('Тестовый алерт отправлен')).toBeVisible();

  await page.getByRole('link', { name: 'События' }).click();
  await expect(page.getByText('Тестовый зритель')).toBeVisible({ timeout: 5_000 });
});

test('«Принять все» в баннере отражается в разделе «Приватность»', async ({ page }) => {
  await registerStreamer(page, 'e2e-cookies');

  await page.getByRole('button', { name: 'Принять все' }).click();
  await page.getByRole('link', { name: 'Приватность' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Статистика посещений (cookie)' });
  await expect(row).toContainText('Принято');

  // И в обратную сторону: отзыв в разделе — это ответ «только необходимые», а не
  // «спросите снова». После перезагрузки баннер появляться не должен.
  await row.getByRole('button', { name: 'Отозвать' }).click();
  await expect(row).toContainText('Не принято');
  await page.reload();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Статистика посещений (cookie)' }),
  ).toContainText('Не принято');
  await expect(page.getByRole('button', { name: 'Принять все' })).toHaveCount(0);
});

test('чат доезжает до оверлея, если канал вписали после открытия ссылки', async ({
  page,
  context,
}) => {
  // Воркера в сквозном прогоне нет, поэтому сообщение кладётся в шину напрямую —
  // так проверяется доставка от шины до экрана, а соединение с Twitch закрыто
  // интеграционным тестом. Порядок действий — как у живого стримера: сначала
  // ссылка в OBS, потом канал в настройках.
  await registerStreamer(page, 'e2e-chat-late');
  await dismissBanner(page);

  await page.getByPlaceholder('Название виджета').fill('Чат');
  await page.getByLabel('Тип виджета').selectOption('chat');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();

  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });

  const overlay = await context.newPage();
  await overlay.goto(await field.inputValue());
  // Оверлей должен успеть подключиться ДО смены канала.
  await page.reload();
  await expect(page.getByText('Последняя активность: не подключалась')).toHaveCount(0, {
    timeout: 15_000,
  });

  await page.getByLabel('Канал Twitch').fill('dystopia_there');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  // Сохранение асинхронное: опрос ниже повторяет публикацию, пока настройки не
  // доедут до шлюза и оверлей не переселится в комнату нового канала.

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  try {
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
                channel: 'dystopia_there',
                login: 'viewer',
                username: 'Зритель из чата',
                color: '#7FD1B9',
                badges: [],
                parts: [{ kind: 'text', value: 'привет из офлайн-чата' }],
                sentAt: new Date().toISOString(),
              },
            }),
          );
          return overlay.getByText('привет из офлайн-чата').count();
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  } finally {
    redis.disconnect();
  }
});

test('согласие на cookie не переходит к следующему пользователю той же вкладки', async ({
  page,
}) => {
  // Найдено код-ревью, а не вручную: выход не чистил кэш запросов, и баннер
  // нового пользователя сверялся с журналом согласий предыдущего. «Принять все»
  // одного человека молча становилось согласием другого.
  await registerStreamer(page, 'e2e-consent-a');
  await page.getByRole('button', { name: 'Принять все' }).click();
  await expect(page.getByRole('button', { name: 'Принять все' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Без перезагрузки страницы — ровно так, как это делает человек у общего
  // компьютера: вышел, и следующий сразу регистрируется. Переход по ссылке, а не
  // goto: полная загрузка страницы очистила бы кэш сама и спрятала баг.
  await page.getByRole('link', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
  await fillRegistration(page, 'e2e-consent-b');
  await expect(page.getByRole('button', { name: 'Принять все' })).toBeVisible({ timeout: 5_000 });
});

test('на телефоне меню дашборда свёрнуто и закрывается переходом', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await registerStreamer(page, 'e2e-mobile');
  await dismissBanner(page);

  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await expect(nav).toBeHidden();

  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Виджеты' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'События' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(nav).toBeHidden();
  await expect(page).toHaveTitle('Последние события — StreamKit');
  // После перехода фокус на содержимом, а не на исчезнувшем пункте меню.
  await expect(page.locator('main')).toBeFocused();
});
