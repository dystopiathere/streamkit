import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { generateSync } from 'otplib';

/**
 * Админка в настоящем браузере.
 *
 * Права, блокировка и её следствия закрыты интеграционными тестами. Здесь —
 * то, чего они не видят: собранная админка на своём origin входит отдельной
 * сессией, ходит в API через CORS с cookie и доводит действие сотрудника до
 * стримера.
 */
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:5175';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const PASSWORD = 'очень-надёжный-пароль-1';

interface Account {
  email: string;
  token: string;
}

async function register(request: APIRequestContext, prefix: string): Promise<Account> {
  const email = `${prefix}-${Date.now()}@example.com`;
  const response = await request.post(`${API_URL}/api/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      displayName: `E2E ${prefix}`,
      acceptDocuments: true,
    },
  });
  expect(response.ok()).toBe(true);
  return { email, token: ((await response.json()) as { accessToken: string }).accessToken };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Сотрудник: второй фактор включается через API дашборда, роль — скриптом,
 * как первому админу на сервере. Скрипт — тот же, что в инструкции выкатки.
 */
async function staffAccount(request: APIRequestContext): Promise<Account & { secret: string }> {
  const account = await register(request, 'e2e-admin');
  const setup = await request.post(`${API_URL}/api/auth/totp/setup`, {
    headers: bearer(account.token),
  });
  const { secret } = (await setup.json()) as { secret: string };
  const confirm = await request.post(`${API_URL}/api/auth/totp/confirm`, {
    headers: bearer(account.token),
    data: { code: generateSync({ secret }) },
  });
  expect(confirm.ok()).toBe(true);

  execFileSync('node', ['dist/scripts/grant-role.js', account.email, 'admin'], {
    // Playwright запускается из каталога e2e.
    cwd: resolve(process.cwd(), '../apps/api'),
    stdio: 'pipe',
  });
  return { ...account, secret };
}

async function adminLogin(page: Page, account: Account & { secret: string }): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Электронная почта').fill(account.email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByLabel('Код подтверждения').fill(generateSync({ secret: account.secret }));
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
}

test('сотрудник находит стримера, отзывает ссылку OBS и блокирует аккаунт', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const streamer = await register(request, 'e2e-target');
  const widget = await request.post(`${API_URL}/api/widgets`, {
    headers: bearer(streamer.token),
    data: { name: 'Алерты для админки', type: 'alerts', config: {} },
  });
  const widgetId = ((await widget.json()) as { id: string }).id;
  await request.post(`${API_URL}/api/widgets/${widgetId}/tokens`, {
    headers: bearer(streamer.token),
    data: { label: 'Сцена OBS' },
  });

  const admin = await staffAccount(request);
  await adminLogin(page, admin);

  // Обзор: графики на месте, и у каждого есть текстовая сводка.
  await expect(page.getByRole('figure', { name: 'Регистрации' })).toBeVisible();
  await expect(page.getByText(/^Регистрации: всего/)).toBeAttached();

  // Поиск и карточка.
  await page
    .getByRole('navigation', { name: 'Разделы админки' })
    .getByRole('link', { name: 'Пользователи' })
    .click();
  await page.getByLabel('Поиск').fill(streamer.email);
  await page.getByRole('button', { name: 'Найти' }).click();
  await page.getByRole('link', { name: new RegExp(streamer.email) }).click();
  await expect(page.getByRole('heading', { name: 'E2E e2e-target' })).toBeVisible();

  // Отзыв ссылки.
  await page.getByRole('button', { name: 'Отозвать ссылку «Сцена OBS»' }).click();
  const revokeDialog = page.getByRole('dialog', { name: /Отозвать ссылку/ });
  await revokeDialog.getByRole('button', { name: 'Отозвать' }).click();
  await expect(page.getByText('Ссылки отозваны')).toBeVisible();
  const tokens = await request.get(`${API_URL}/api/widgets/${widgetId}/tokens`, {
    headers: bearer(streamer.token),
  });
  expect(await tokens.json()).toEqual([]);

  // Блокировка: без причины кнопка не нажимается, с причиной — стример выброшен.
  await page.getByRole('button', { name: 'Заблокировать' }).click();
  const suspendDialog = page.getByRole('dialog', { name: /Заблокировать/ });
  const confirm = suspendDialog.getByRole('button', { name: 'Заблокировать' });
  await expect(confirm).toBeDisabled();
  await suspendDialog.getByLabel('Причина').fill('E2E: проверка блокировки');
  await confirm.click();
  await expect(page.getByText('Аккаунт заблокирован')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Разблокировать' })).toBeVisible();

  const after = await request.get(`${API_URL}/api/widgets`, { headers: bearer(streamer.token) });
  expect(after.status()).toBe(401);

  // Журнал: действие записано за сотрудником.
  await page.getByRole('link', { name: 'Журнал' }).click();
  await page.getByRole('button', { name: 'Только действия сотрудников' }).click();
  await expect(page.getByRole('cell', { name: 'admin.user.suspended' }).first()).toBeVisible();
});

test('токен дашборда не открывает админское API', async ({ request }) => {
  const streamer = await register(request, 'e2e-not-admin');
  const response = await request.get(`${API_URL}/api/admin/users`, {
    headers: bearer(streamer.token),
  });
  expect(response.status()).toBe(401);
});
