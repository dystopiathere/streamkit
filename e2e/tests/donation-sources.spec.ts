import { expect, type Page, test } from '@playwright/test';
import { openProfileSection } from './navigation';

async function registerAndOpenSources(page: Page, name: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill(name);
  await page.getByLabel('Электронная почта').fill(`e2e-sources-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  await page.getByRole('button', { name: 'Только необходимые' }).click();
  await openProfileSection(page, 'Источники');
}

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
  await registerAndOpenSources(page, 'E2E Источники');
  // Карточки сервисов стоят рядом, и у каждой свой статус: ищем внутри своей.
  const card = page.getByRole('region', { name: 'DonationAlerts' });
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Подключить DonationAlerts' }).click();

  // Возврат: API принял код, завёл источник и вернул браузер на страницу.
  await expect(page.getByText('DonationAlerts подключён', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/account\/sources$/);
  await expect(card.getByText('Подключён', { exact: true })).toBeVisible();
  await expect(card.getByText('E2E Стример DA')).toBeVisible();
  await expect(card.getByText('Донатов пока не было')).toBeVisible();

  // Вебхук для разработчиков свёрнут: стримеру он не нужен.
  await expect(page.getByLabel('Адрес вебхука')).toBeHidden();

  await page.getByRole('button', { name: 'Отключить DonationAlerts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отключить DonationAlerts?' });
  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText('Сервис отключён')).toBeVisible();
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();
});

/**
 * Подключение DonatePay ключом API: у сервиса нет OAuth для сторонних
 * приложений. Проверяется то, что видит стример: неверный ключ — понятная
 * ошибка, верный — аккаунт в карточке, а сам ключ на странице не остаётся.
 */
test('стример подключает DonatePay ключом API и отключает его', async ({ page }) => {
  await registerAndOpenSources(page, 'E2E Источники DP');
  const card = page.getByRole('region', { name: 'DonatePay' });
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();
  await expect(
    card.getByRole('link', { name: 'странице API в кабинете DonatePay' }),
  ).toHaveAttribute('href', 'https://donatepay.ru/page/api');

  const key = card.getByLabel('Ключ API DonatePay');
  await card.getByRole('button', { name: 'Подключить DonatePay' }).click();
  await expect(card.getByText('Вставьте ключ API')).toBeVisible();

  await key.fill('wrong-key');
  await card.getByRole('button', { name: 'Подключить DonatePay' }).click();
  await expect(page.getByText('DonatePay не принял ключ API', { exact: false })).toBeVisible();
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();

  await key.fill('e2e-dp-key');
  await card.getByRole('button', { name: 'Подключить DonatePay' }).click();
  await expect(page.getByText('DonatePay подключён', { exact: false })).toBeVisible();
  await expect(card.getByText('Подключён', { exact: true })).toBeVisible();
  await expect(card.getByText('E2E Стример DP')).toBeVisible();
  await expect(card.getByLabel('Ключ API DonatePay')).toHaveCount(0);

  await card.getByRole('button', { name: 'Отключить DonatePay' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отключить DonatePay?' });
  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText('Сервис отключён')).toBeVisible();
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();
});
