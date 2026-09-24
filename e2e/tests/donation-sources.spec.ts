import { expect, test } from '@playwright/test';
import { openProfileSection } from './navigation';

/**
 * Подключение DonationAlerts в настоящем браузере.
 *
 * Интеграционный тест проверяет сокет и приём донатов. Здесь — то, чего он не
 * видит: кнопка уводит на страницу входа сервиса, возврат приходит на API
 * редиректом с чужого домена, и cookie, привязавшая state к браузеру, в этот
 * переход действительно прикладывается. До этого теста путь OAuth в браузере не
 * проходил ни разу — ни для DonationAlerts, ни для площадок аналитики.
 */
test('стример подключает DonationAlerts и отключает его', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Источники');
  await page.getByLabel('Электронная почта').fill(`e2e-sources-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  await page.getByRole('button', { name: 'Только необходимые' }).click();

  await openProfileSection(page, 'Источники');
  await expect(page.getByRole('heading', { name: 'DonationAlerts' })).toBeVisible();
  await expect(page.getByText('Не подключён', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Подключить DonationAlerts' }).click();

  // Возврат: API принял код, завёл источник и вернул браузер на страницу.
  await expect(page.getByText('DonationAlerts подключён', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/account\/sources$/);
  await expect(page.getByText('Подключён', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Стример DA')).toBeVisible();
  await expect(page.getByText('Донатов пока не было')).toBeVisible();

  // Вебхук для разработчиков свёрнут: стримеру он не нужен.
  await expect(page.getByLabel('Адрес вебхука')).toBeHidden();

  await page.getByRole('button', { name: 'Отключить DonationAlerts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отключить DonationAlerts?' });
  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText('Сервис отключён')).toBeVisible();
  await expect(page.getByText('Не подключён', { exact: true })).toBeVisible();
});
