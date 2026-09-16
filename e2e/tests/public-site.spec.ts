import { expect, test } from '@playwright/test';

/**
 * Публичная часть сайта — то, что ЮKassa проверяет до подключения оплаты.
 *
 * Модерация отказывает, если без входа в аккаунт не видно цен, порядка
 * получения услуги, оферты и реквизитов продавца. Проверяется собранный сайт
 * глазами посетителя, у которого нет аккаунта.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

test('главная без входа показывает цены, получение услуги, оплату и реквизиты', async ({
  page,
}) => {
  const seller = (await (await page.request.get(`${API_URL}/api/public/seller`)).json()) as {
    name: string | null;
    inn: string | null;
  };
  // Рядом с `pnpm dev` реквизиты могут быть не заполнены; в CI они заданы, и
  // пропуск там означал бы молча выключенную проверку.
  test.skip(!seller.inn && !process.env.CI, 'Реквизиты продавца на этом API не заполнены');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const pricing = page.locator('#pricing');
  await expect(pricing.getByText('Бесплатный')).toBeVisible();
  await expect(pricing.getByText(/490\s₽ в месяц/)).toBeVisible();
  await expect(pricing.getByText(/4\s900\s₽ в год/)).toBeVisible();

  await expect(page.locator('#delivery')).toContainText('Физической доставки нет');
  await expect(page.locator('#payment')).toContainText('ЮKassa');

  const contacts = page.locator('#contacts');
  await expect(contacts).toContainText(seller.name!);
  await expect(contacts).toContainText(seller.inn!);
  await expect(contacts).toContainText('самозанятый');
  await expect(page.getByTestId('seller-requisites')).toContainText(seller.inn!);

  // Оферта открывается из подвала, с подставленными реквизитами и ценой.
  await page.getByRole('link', { name: 'Оферта тарифа «Про»' }).click();
  await expect(page).toHaveURL(/\/legal\/subscription$/);
  const offer = page.locator('pre');
  await expect(offer).toContainText(seller.inn!);
  await expect(offer).toContainText(/490\s₽ за один календарный месяц/);
  await expect(offer).not.toContainText('{{');
});

test('посетитель без аккаунта отвечает на баннер, и согласие уходит в журнал', async ({ page }) => {
  await page.goto('/');

  // Согласие посетителя — запись в журнал на сервере, а не только в браузере.
  const consent = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/public/site-stats/consent') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Принять все' }).click();
  expect((await consent).status()).toBe(204);
  await expect(page.getByRole('button', { name: 'Принять все' })).toHaveCount(0);

  // «Настройки cookie» в подвале отзывают согласие и снова показывают баннер.
  const revoke = page.waitForResponse((response) =>
    response.url().endsWith('/api/public/site-stats/consent/revoke'),
  );
  await page.getByRole('button', { name: 'Настройки cookie' }).click();
  expect((await revoke).status()).toBe(204);
  await expect(page.getByRole('button', { name: 'Принять все' })).toBeVisible();
});
