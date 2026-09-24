import { expect, test } from '@playwright/test';
import { logout, mainNav, openProfileMenu, openProfileSection } from './navigation';

/**
 * Профиль: меню под именем в шапке, раздел «Безопасность» и карта кабинета в
 * подвале.
 *
 * Восстановление пароля по письму здесь не проходится: API в сквозном прогоне
 * работает в production-режиме, а там письма уходят только по TLS, и
 * поддельного SMTP с TLS в прогоне нет. Сервер закрыт `password.int.test.ts`,
 * страница — ручной проверкой через mailpit (`compose.dev.yml`).
 */
test('стример меняет пароль в профиле и остаётся в аккаунте', async ({ page }) => {
  const email = `e2e-account-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Профиль');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  const banner = page.getByRole('button', { name: 'Только необходимые' });
  await banner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await banner.isVisible()) await banner.click();

  // В шапке — только рабочие разделы; профиль — под именем.
  await expect(mainNav(page).getByRole('link', { name: 'Тариф', exact: true })).toHaveCount(0);
  const menu = await openProfileMenu(page);
  await expect(menu.getByRole('link')).toHaveText([
    'Площадки',
    'Безопасность',
    'Тариф',
    'Приватность',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await openProfileSection(page, 'Безопасность');
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Безопасность' })).toBeVisible();

  // Опечатка в повторе ловится до запроса.
  await page.getByLabel('Текущий пароль').fill('очень-надёжный-пароль-1');
  await page.getByLabel('Новый пароль', { exact: true }).fill('совсем-новый-пароль-42');
  await page.getByLabel('Повторите новый пароль').fill('совсем-новый-пароль-43');
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(page.getByText('Пароли не совпадают')).toBeVisible();

  await page.getByLabel('Повторите новый пароль').fill('совсем-новый-пароль-42');
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(
    page.getByText('Пароль изменён, остальные устройства вышли из аккаунта'),
  ).toBeVisible();

  // Это устройство получило новую сессию: перезагрузка не выкидывает на вход.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Безопасность' })).toBeVisible();
  await expect(page.getByText('Это устройство')).toBeVisible();

  // Карта кабинета в подвале: разделы шапки и профиля.
  const footerMap = page.getByRole('navigation', { name: 'Профиль', exact: true });
  await expect(footerMap.getByRole('link', { name: 'Безопасность' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name: 'Аналитика' }),
  ).toBeVisible();

  await logout(page);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill('совсем-новый-пароль-42');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  // Старый адрес раздела ведёт в профиль — на него ссылаются письма о продлении.
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/account\/privacy$/);
});
