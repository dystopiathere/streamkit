import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { logout, openProfileSection } from './navigation';

/**
 * Двухфакторный вход через интерфейс дашборда.
 *
 * API для него было готово давно, а экрана не было: сквозной тест админки
 * включал второй фактор запросом, и то, что человеку включить его негде,
 * обнаружилось только на проде — у первого админа.
 */
const PASSWORD = 'очень-надёжный-пароль-1';

test('стример включает двухфакторный вход, входит с кодом и выключает его', async ({ page }) => {
  const email = `e2e-totp-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Второй фактор');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);
  await page.getByRole('button', { name: 'Только необходимые' }).click();

  await openProfileSection(page, 'Безопасность');
  await expect(page.getByRole('heading', { name: 'Двухфакторный вход' })).toBeVisible();
  await expect(page.getByText('Выключен', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Включить' }).click();
  await expect(
    page.getByRole('img', { name: 'QR-код для приложения-аутентификатора' }),
  ).toBeVisible();
  const secret = (await page.locator('code').first().innerText()).replace(/\s/g, '');

  // Неверный код не включает второй фактор — иначе человек запер бы себя.
  await page.getByLabel('Код из приложения').fill('000000');
  await page.getByRole('button', { name: 'Подтвердить и включить' }).click();
  await expect(page.getByText('Неверный код подтверждения')).toBeVisible();

  // Каждый код принимается один раз: включение, вход и выключение берут коды
  // соседних шагов — допуск часов принимает все три.
  const step = (offset: number) =>
    generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + offset * 30 });
  await page.getByLabel('Код из приложения').fill(step(-1));
  await page.getByRole('button', { name: 'Подтвердить и включить' }).click();
  await expect(page.getByText('Двухфакторный вход включён')).toBeVisible();
  await expect(page.getByText('Включён', { exact: true })).toBeVisible();

  // Вход теперь требует код.
  await logout(page);
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Код из приложения').fill(step(0));
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  await openProfileSection(page, 'Безопасность');
  await expect(page.getByText('Включён', { exact: true })).toBeVisible();
  // На странице две карточки с «Текущим паролем»: смена пароля и второй фактор.
  const twoFactor = page.getByRole('region', { name: 'Двухфакторный вход' });
  await twoFactor.getByLabel('Текущий пароль').fill(PASSWORD);
  // Без кода из приложения выключить второй фактор нельзя: одного пароля мало.
  await expect(
    twoFactor.getByRole('button', { name: 'Выключить двухфакторный вход' }),
  ).toBeDisabled();
  await twoFactor.getByLabel('Код из приложения').fill(step(1));
  await twoFactor.getByRole('button', { name: 'Выключить двухфакторный вход' }).click();
  await expect(page.getByText('Двухфакторный вход выключен')).toBeVisible();
  await expect(page.getByText('Выключен', { exact: true })).toBeVisible();
});
