import { expect, test } from '@playwright/test';
import { mainNav } from './navigation';

/**
 * Сквозной сценарий, ради которого существует продукт:
 * регистрация → виджет → ссылка для OBS → тестовый алерт → алерт на экране.
 *
 * Проверяется ровно то, что нельзя проверить ни юнит-, ни feature-тестами:
 * что собранный overlay действительно устанавливает соединение и отрисовывает
 * событие, дошедшее через Redis и сокет.
 */
test('донат доходит от дашборда до оверлея', async ({ page, context }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'очень-надёжный-пароль-1';

  await test.step('регистрация с согласиями', async () => {
    await page.goto('/register');

    await page.getByLabel('Отображаемое имя').fill('E2E Стример');
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль').fill(password);

    // Согласия не проставлены заранее — их отмечает пользователь.
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }

    await page.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(page).toHaveURL(/\/widgets$/);
  });

  await test.step('создание виджета', async () => {
    await page.getByPlaceholder('Название виджета').fill('Алерты донатов');
    await page.getByRole('button', { name: 'Новый виджет' }).click();
    await expect(page.getByText('Алерты донатов')).toBeVisible();
  });

  let overlayUrl = '';

  await test.step('выпуск ссылки для OBS', async () => {
    await page.getByRole('link', { name: 'Настроить' }).first().click();
    await expect(page.getByText('Ссылки для браузер-сорса')).toBeVisible();

    await page.getByRole('button', { name: 'Создать ссылку' }).click();

    // Ссылка показывается один раз — забираем её сразу из поля.
    const field = page.locator('input[readonly]').first();
    await expect(field).toHaveValue(/token=/, { timeout: 10_000 });
    overlayUrl = await field.inputValue();
  });

  const overlayPage = await context.newPage();

  await test.step('подключение оверлея', async () => {
    await overlayPage.goto(overlayUrl);
    // Оверлей ничего не рисует, пока нет событий: ждём именно установления
    // соединения, а не появления разметки.
    await overlayPage.waitForTimeout(1500);
  });

  await test.step('тестовый алерт доходит до оверлея', async () => {
    await mainNav(page).getByRole('link', { name: 'Виджеты', exact: true }).click();
    await page.getByRole('button', { name: 'Тестовый алерт' }).click();

    const card = overlayPage.getByTestId('alert-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Тестовый зритель');
  });

  await test.step('алерт исчезает по истечении времени показа', async () => {
    // durationMs по умолчанию 6000 плюс анимация ухода.
    await expect(overlayPage.getByTestId('alert-card')).toBeHidden({ timeout: 15_000 });
  });

  await test.step('событие попало в историю', async () => {
    await mainNav(page).getByRole('link', { name: 'События', exact: true }).click();
    await expect(page.getByText('Тестовый зритель')).toBeVisible();
    await expect(page.getByText('тест', { exact: true })).toBeVisible();
  });
});

test('отозванная ссылка перестаёт работать', async ({ page, context }) => {
  const email = `e2e-revoke-${Date.now()}@example.com`;
  const password = 'очень-надёжный-пароль-1';

  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Отзыв');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  await page.getByPlaceholder('Название виджета').fill('Виджет для отзыва');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await page.getByRole('button', { name: 'Создать ссылку' }).click();

  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });
  const overlayUrl = await field.inputValue();

  const overlayPage = await context.newPage();
  await overlayPage.goto(overlayUrl);
  await overlayPage.waitForTimeout(1000);

  // Отзываем ссылку: подтверждение показывается нативным диалогом.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Отозвать' }).click();
  await expect(page.getByText('Ссылок пока нет')).toBeVisible();

  // Алерт после отзыва до оверлея дойти не должен.
  await mainNav(page).getByRole('link', { name: 'Виджеты', exact: true }).click();
  await page.getByRole('button', { name: 'Тестовый алерт' }).click();

  await overlayPage.waitForTimeout(3000);
  await expect(overlayPage.getByTestId('alert-card')).toHaveCount(0);
});

test('у каждого события свой сценарий: текст фолловера и выключенный рейд', async ({
  page,
  context,
}) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Сценарии');
  await page.getByLabel('Электронная почта').fill(`e2e-scenario-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  await page.getByPlaceholder('Название виджета').fill('Оповещения');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();

  // Свой заголовок у фолловера, рейд выключен. Сохраняются все сценарии сразу.
  await page.getByRole('tab', { name: 'Фолловер' }).click();
  // Шаблоны — в разделе «Текст»: форма разбита на разделы, а не идёт простынёй.
  await page.getByRole('tab', { name: 'Текст', exact: true }).click();
  await page.getByLabel('Заголовок', { exact: true }).fill('Спасибо за фоллов, {username}!');
  await page.getByRole('tab', { name: 'Рейд' }).click();
  await page.getByLabel('Показывать это оповещение').uncheck();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/api/widgets/'),
  );
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  expect((await saved).ok()).toBe(true);

  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });
  const overlay = await context.newPage();
  await overlay.goto(await field.inputValue());
  await overlay.waitForTimeout(1500);

  // Выключенный сценарий не показывает и проверку: стример видит то же, что зрители.
  await page.getByRole('button', { name: 'Проверить в OBS' }).click();
  await expect(page.getByText('Тестовое оповещение отправлено')).toBeVisible();
  await overlay.waitForTimeout(2000);
  await expect(overlay.getByTestId('alert-card')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Фолловер' }).click();
  await page.getByRole('button', { name: 'Проверить в OBS' }).click();
  const card = overlay.getByTestId('alert-card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Спасибо за фоллов, Тестовый зритель!');
});
