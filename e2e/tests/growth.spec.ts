import { expect, test, type Page } from '@playwright/test';
import { confirmEmail } from './email';
import { buyPlan } from './plans';
import { mainNav, openProfileSection } from './navigation';

/**
 * Петли роста: подпись бесплатного тарифа, пробный «Про» и ссылка на
 * регистрацию у гостя комнаты.
 *
 * Сервер закрыт `trial.int.test.ts`. Здесь — то, чего он не видит: подпись в
 * собранном оверлее и в предпросмотре редактора, её уход из УЖЕ открытой сцены
 * после включения пробного периода (сообщение `plan-changed`) и промокод
 * стримера в ссылке на странице гостя.
 */
async function registerStreamer(
  page: Page,
  prefix: string,
): Promise<{ accessToken: string; email: string }> {
  const email = `${prefix}-${Date.now()}@example.com`;
  const registered = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register'),
  );
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Рост');
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
  const { accessToken } = (await (await registered).json()) as { accessToken: string };
  return { accessToken, email };
}

test('подпись бесплатного тарифа уходит из редактора и открытой сцены с пробным «Про»', async ({
  page,
  context,
}) => {
  const { email } = await registerStreamer(page, 'e2e-trial');

  await page.getByPlaceholder('Название виджета').fill('Цель с подписью');
  await page.getByLabel('Тип виджета').selectOption('goal');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();

  // Предпросмотр показывает подпись там же, где её увидят зрители.
  await expect(page.getByTestId('widget-branding')).toHaveText('stream-kit.ru');

  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const obsField = page.locator('input[readonly]').first();
  await expect(obsField).toHaveValue(/token=/, { timeout: 10_000 });
  const overlay = await context.newPage();
  await overlay.goto(await obsField.inputValue());
  await expect(overlay.getByTestId('goal-bar')).toBeVisible({ timeout: 15_000 });
  await expect(overlay.getByTestId('widget-branding')).toBeVisible();

  // Пробный период — только подтверждённой почте.
  confirmEmail(email);
  await page.reload();
  await openProfileSection(page, 'Тариф');
  await page.getByRole('button', { name: 'Включить пробный период на 14 дней' }).click();
  await expect(page.getByTestId('bonus-pro')).toContainText('Идёт пробный период «Про».');
  await expect(
    page.getByRole('button', { name: 'Включить пробный период на 14 дней' }),
  ).toHaveCount(0);

  // Сцена, открытая до смены тарифа, конфиг сама не перезапрашивает.
  await expect(overlay.getByTestId('widget-branding')).toHaveCount(0, { timeout: 10_000 });
  await expect(overlay.getByTestId('goal-bar')).toBeVisible();

  await mainNav(page).getByRole('link', { name: 'Виджеты', exact: true }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await expect(page.getByTestId('goal-bar')).toBeVisible();
  await expect(page.getByTestId('widget-branding')).toHaveCount(0);
});

test('у оповещений подпись появляется только вместе с оповещением', async ({ page, context }) => {
  await registerStreamer(page, 'e2e-badge-alerts');

  await page.getByPlaceholder('Название виджета').fill('Оповещения с подписью');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const obsField = page.locator('input[readonly]').first();
  await expect(obsField).toHaveValue(/token=/, { timeout: 10_000 });

  const overlay = await context.newPage();
  const connected = overlay.waitForEvent('websocket');
  await overlay.goto(await obsField.inputValue());
  await connected;
  // Пустая сцена между событиями — без подписи в углу.
  await overlay.waitForTimeout(1_000);
  await expect(overlay.getByTestId('widget-branding')).toHaveCount(0);

  await mainNav(page).getByRole('link', { name: 'Виджеты', exact: true }).click();
  await page.getByRole('button', { name: 'Тестовый алерт' }).click();
  await expect(overlay.getByTestId('alert-card')).toBeVisible({ timeout: 15_000 });
  await expect(overlay.getByTestId('widget-branding')).toBeVisible();
});

test('гость комнаты видит ссылку на регистрацию с промокодом стримера', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { accessToken } = await registerStreamer(page, 'e2e-guest-link');
  await buyPlan(page, accessToken, 'pro');

  await mainNav(page).getByRole('link', { name: 'Комнаты', exact: true }).click();
  await page.getByPlaceholder('Название комнаты').fill('Вечерний эфир');
  await page.getByRole('button', { name: 'Новая комната' }).click();
  await page.getByRole('link', { name: 'Открыть' }).click();
  await page.getByPlaceholder('Кому ссылка').fill('Гость подкаста');
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const inviteField = page.getByRole('textbox', { name: 'Приглашения' });
  await expect(inviteField).toHaveValue(/\/join#/, { timeout: 10_000 });
  const inviteUrl = await inviteField.inputValue();

  const referrals = await page.request.get(
    `${process.env.E2E_API_URL ?? 'http://localhost:3000'}/api/referrals`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const { code } = (await referrals.json()) as { code: string };

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  const promo = guest.getByRole('link', { name: /Создайте свою бесплатно/ });
  await expect(promo).toBeVisible();

  await guest.getByLabel('Ваше имя').fill('Вася');
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();
  await expect(guest.getByText('Вы в комнате «Вечерний эфир»')).toBeVisible({ timeout: 15_000 });
  await expect(promo).toHaveAttribute('href', `/register?ref=${code}`);
  await expect(promo).toHaveAttribute('target', '_blank');

  // Ссылка открывается в новой вкладке, и созвон в этой не обрывается.
  const [signup] = await Promise.all([guestContext.waitForEvent('page'), promo.click()]);
  await signup.waitForLoadState();
  await expect(signup.getByLabel('Промокод пригласившего')).toHaveValue(code);
  await expect(guest.getByText('Вы в комнате «Вечерний эфир»')).toBeVisible();

  await guestContext.close();
});
