import { expect, test, type Page } from '@playwright/test';

/**
 * Виджеты, отличные от алертов, доходят до браузер-сорса.
 *
 * Проверяется ровно то, что не покрывают feature-тесты: собранный overlay
 * узнаёт ТИП виджета из bootstrap и выбирает нужный рендерер. До этого этапа
 * тип был один и в сообщении не передавался вовсе.
 *
 * Движение полосы цели сюда не входит: цель наполняют только настоящие донаты,
 * а тестовый алерт помечен `isTest` и в сумму намеренно не идёт. Эта развилка
 * проверяется интеграционным тестом, где событие можно засеять напрямую.
 */
async function registerStreamer(page: Page, prefix: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Виджеты');
  await page.getByLabel('Электронная почта').fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
}

async function issueOverlayUrl(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await page.getByRole('button', { name: 'Создать ссылку' }).click();

  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });
  return field.inputValue();
}

test('цель отрисовывается в оверлее', async ({ page, context }) => {
  await registerStreamer(page, 'e2e-goal');

  await page.getByPlaceholder('Название виджета').fill('Цель на новый микрофон');
  await page.getByLabel('Тип виджета').selectOption('goal');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await expect(page.getByText('Цель на новый микрофон')).toBeVisible();

  const overlayUrl = await issueOverlayUrl(page);

  const overlayPage = await context.newPage();
  await overlayPage.goto(overlayUrl);

  await expect(overlayPage.getByTestId('goal-bar')).toBeVisible({ timeout: 15_000 });
  // Полоса пустая: настоящих донатов ещё не было, и выдумывать их нельзя.
  await expect(overlayPage.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('таймер запускается из дашборда и идёт в оверлее', async ({ page, context }) => {
  await registerStreamer(page, 'e2e-timer');

  await page.getByPlaceholder('Название виджета').fill('Марафон');
  await page.getByLabel('Тип виджета').selectOption('timer');
  await page.getByRole('button', { name: 'Новый виджет' }).click();

  const overlayUrl = await issueOverlayUrl(page);

  const overlayPage = await context.newPage();
  await overlayPage.goto(overlayUrl);
  await expect(overlayPage.getByTestId('timer-display')).toBeVisible({ timeout: 15_000 });

  // По умолчанию час и таймер стоит.
  await expect(overlayPage.getByTestId('timer-display')).toContainText('01:00:00');

  await page.getByRole('button', { name: 'Запустить' }).click();

  // Через две секунды отсчёт обязан уйти вниз: оверлей тикает сам, от
  // присланного момента окончания, а не ждёт сообщений с сервера.
  await expect
    .poll(async () => overlayPage.getByTestId('timer-display').textContent(), { timeout: 15_000 })
    .not.toContain('01:00:00');
});
