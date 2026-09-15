import { expect, test } from '@playwright/test';

/**
 * Тариф «Про» целиком: от закрытых комнат до оплаты и отключения продления.
 *
 * ЮKassa — фальшивая (`fake-yookassa.mjs`), но путь настоящий: браузер уходит
 * на страницу оплаты, та шлёт уведомление в API и возвращает браузер назад, а
 * API сам переспрашивает статус платежа. Проверяется ровно то, что без живого
 * браузера не увидеть: редирект, возврат и то, что интерфейс дожидается оплаты.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

test('стример оформляет тариф «Про», получает комнаты и отключает продление', async ({ page }) => {
  test.setTimeout(90_000);
  const registered = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register'),
  );
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Тариф');
  await page.getByLabel('Электронная почта').fill(`e2e-billing-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  const banner = page.getByRole('button', { name: 'Только необходимые' });
  await banner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await banner.isVisible()) await banner.click();

  const { accessToken } = (await (await registered).json()) as { accessToken: string };
  const subscription = await page.request.get(`${API_URL}/api/billing/subscription`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { billingConfigured } = (await subscription.json()) as { billingConfigured: boolean };
  // Локально рядом с `pnpm dev` оплата может быть не настроена — тогда комнаты
  // бесплатны и проверять нечего. В CI API поднимается с фальшивой ЮKassa, и
  // пропуск там означал бы молча выключенную проверку.
  test.skip(!billingConfigured && !process.env.CI, 'Оплата на этом API не настроена');
  expect(billingConfigured).toBe(true);

  // Без тарифа комнаты закрыты — и это видно, а не просто «ошибка».
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await expect(page.getByText('Приватные комнаты — в тарифе «Про»')).toBeVisible();
  await page.getByPlaceholder('Название комнаты').fill('Вечерний эфир');
  await expect(page.getByRole('button', { name: 'Новая комната' })).toBeDisabled();

  // Оплата: без согласия с офертой кнопка не нажимается.
  await page.getByRole('link', { name: 'Выбрать тариф' }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await page.getByRole('radio', { name: /Месяц/ }).check();
  const pay = page.getByRole('button', { name: /^Оплатить/ });
  await expect(pay).toBeDisabled();
  await page.getByLabel(/Я принимаю/).check();
  await pay.click();

  // Страница ЮKassa «оплачивает» и возвращает браузер с идентификатором платежа.
  await expect(page).toHaveURL(/\/billing\?payment=[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByText('Оплата прошла — тариф «Про» подключён.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('subscription-status')).toContainText('продлится автоматически');
  await expect(page.getByText('Способ оплаты: Карта *4444')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Оплачен' })).toBeVisible();

  // Комнаты открылись.
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await expect(page.getByText('Приватные комнаты — в тарифе «Про»')).toHaveCount(0);
  await page.getByPlaceholder('Название комнаты').fill('Вечерний эфир');
  await page.getByRole('button', { name: 'Новая комната' }).click();
  await expect(page.getByRole('link', { name: 'Открыть' })).toBeVisible();

  // Отключение продления — одной кнопкой; доступ доживает оплаченный период.
  await page.getByRole('link', { name: 'Тариф' }).click();
  await page.getByRole('button', { name: 'Отключить автопродление' }).click();
  await expect(page.getByTestId('subscription-status')).toContainText('Автопродление выключено');
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await expect(page.getByRole('link', { name: 'Открыть' })).toBeVisible();
  await expect(page.getByText('Приватные комнаты — в тарифе «Про»')).toHaveCount(0);
});
