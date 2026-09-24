import { expect, test } from '@playwright/test';
import { mainNav } from './navigation';

/**
 * Английская версия сайта.
 *
 * Браузер во всех сценариях русский (`locale` в playwright.config.ts), так что
 * английский включается ссылкой с `?lang=en` — так её дают проверяющим, — а
 * дальше держится выбором в localStorage. Проверяется то, что не видно
 * юнит-тестам словарей: перевод доходит до экрана, включая тексты, пришедшие
 * не из словаря интерфейса, — ошибку сервера, тестовый алерт, документ.
 */
test('английский сайт: главная, вход, дашборд, документы и обратно на русский', async ({
  page,
}) => {
  await test.step('главная по ссылке с ?lang=en', async () => {
    await page.goto('/?lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', {
        name: 'Alerts, widgets and guests on stream — in one link for OBS',
      }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  });

  await test.step('ошибка сервера — по-английски', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(`e2e-en-missing-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('not-the-right-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Wrong email or password')).toBeVisible();
  });

  await test.step('регистрация и тестовый алерт', async () => {
    await page.goto('/register');
    await page.getByLabel('Display name').fill('E2E English');
    await page.getByLabel('Email').fill(`e2e-en-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('a-very-reliable-password-1');
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/widgets$/);
    await page.getByRole('button', { name: 'Necessary only' }).click();

    await page.getByPlaceholder('Widget name').fill('Donation alerts');
    await page.getByRole('button', { name: 'New widget' }).click();
    await expect(page.getByText('Donation alerts')).toBeVisible();
    await page.getByRole('button', { name: 'Test alert' }).click();
    await expect(page.getByText('Test alert sent')).toBeVisible();

    await mainNav(page, 'Sections').getByRole('link', { name: 'Events', exact: true }).click();
    await expect(page.getByText('Test viewer')).toBeVisible();
  });

  await test.step('документ — перевод со ссылкой на русский оригинал', async () => {
    await page.goto('/legal/privacy');
    const article = page.getByRole('article');
    await expect(
      article.getByRole('heading', { level: 1, name: 'StreamKit Privacy Policy' }),
    ).toBeVisible();
    await expect(article).toContainText('Version No.');

    await article.getByRole('link', { name: 'Russian version' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Политика конфиденциальности StreamKit' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  });

  await test.step('выбор языка переживает перезагрузку, переключатель возвращает английский', async () => {
    await page.reload();
    await expect(page.getByRole('link', { name: 'Политика конфиденциальности' })).toBeVisible();

    await page.getByRole('button', { name: 'Версия сайта на английском' }).click();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'StreamKit Privacy Policy' }),
    ).toBeVisible();
  });
});
