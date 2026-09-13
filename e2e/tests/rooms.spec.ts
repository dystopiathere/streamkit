import { expect, test, type Page } from '@playwright/test';

/**
 * Приватная комната целиком, через настоящий LiveKit.
 *
 * Интеграционные тесты проверяют решения платформы с подменённым медиасервером.
 * Здесь — то, что без живого SFU не увидеть: гость реально публикует видео,
 * невидимый оверлей реально его получает и рисует, а удаление с отзывом ссылки
 * реально выкидывает гостя и не пускает обратно.
 *
 * Камера — фальшивое устройство Chromium (см. playwright.config.ts), поэтому
 * у видео в оверлее есть настоящие размеры кадра.
 */
/**
 * Ширина кадра видео. Пакет сквозных тестов собирается без DOM-типов: код внутри
 * `evaluate` исполняется в браузере, а типизирован как Node.
 */
const videoWidth = (element: unknown): number => (element as { videoWidth: number }).videoWidth;

async function registerStreamer(page: Page): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Комнаты');
  await page.getByLabel('Электронная почта').fill(`e2e-rooms-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  const banner = page.getByRole('button', { name: 'Только необходимые' });
  await banner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await banner.isVisible()) await banner.click();
}

test('гость входит по ссылке, оверлей показывает его видео, отзыв выкидывает', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  page.on('dialog', (dialog) => void dialog.accept());

  await registerStreamer(page);

  // Комната и приглашение.
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await page.getByPlaceholder('Название комнаты').fill('Вечерний эфир');
  await page.getByRole('button', { name: 'Новая комната' }).click();
  await page.getByRole('link', { name: 'Открыть' }).click();

  await page.getByPlaceholder('Кому ссылка').fill('Гость подкаста');
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const inviteField = page.getByRole('textbox', { name: 'Приглашения' });
  await expect(inviteField).toHaveValue(/\/join#/, { timeout: 10_000 });
  const inviteUrl = await inviteField.inputValue();

  // Виджет гостей с этой комнатой и ссылка OBS на него.
  await page.getByRole('link', { name: 'Виджеты' }).click();
  await page.getByPlaceholder('Название виджета').fill('Гости');
  await page.getByLabel('Тип виджета').selectOption('guests');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await page.getByLabel('Комната').selectOption({ label: 'Вечерний эфир' });
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/widgets/') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  expect((await saved).status()).toBe(200);

  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const obsField = page.locator('input[readonly]').first();
  await expect(obsField).toHaveValue(/token=/, { timeout: 10_000 });
  const overlay = await context.newPage();
  await overlay.goto(await obsField.inputValue());

  // Гость — в отдельном контексте браузера, без сессии стримера.
  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await guest.getByLabel('Ваше имя').fill('Вася');
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();
  await expect(guest.getByText('Вы в комнате «Вечерний эфир»')).toBeVisible({ timeout: 15_000 });

  // Оверлей: плитка гостя с живым кадром, а не заглушка с именем.
  const tileVideo = overlay.getByTestId('participant-tile').locator('video');
  await expect(tileVideo).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => tileVideo.evaluate(videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(overlay.getByText('Вася')).toBeVisible();

  // Стример входит в комнату, видит гостя и удаляет его с отзывом ссылки.
  await page.goto('/rooms');
  await page.getByRole('link', { name: 'Открыть' }).click();
  await page.getByRole('button', { name: 'Войти в комнату' }).click();
  const guestTile = page.getByTestId('room-tile').filter({ hasText: 'Вася' });
  await expect(guestTile).toBeVisible({ timeout: 30_000 });
  await guestTile.getByRole('button', { name: 'Удалить и отозвать ссылку' }).click();

  await expect(guest.getByText('Стример удалил вас из комнаты.')).toBeVisible({ timeout: 15_000 });
  await expect(overlay.getByTestId('participant-tile')).toHaveCount(0, { timeout: 15_000 });

  // Та же ссылка больше не открывает комнату. Имя форма помнит, согласие —
  // отмечается при каждом входе заново.
  await expect(guest.getByLabel('Ваше имя')).toHaveValue('Вася');
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();
  await expect(guest.getByText(/Ссылка недействительна/)).toBeVisible({ timeout: 10_000 });

  await guestContext.close();
});

test('превью камеры гостя показывает кадр, а не чёрный прямоугольник', async ({ page }) => {
  // Обработчик ошибки, переданный в хук превью новой стрелкой на каждый рендер,
  // пересоздавал камеру по кругу: к видео оставалась прикреплена уже
  // остановленная дорожка. Выглядело это как «камера не работает» — без ошибок.
  // Токен не проверяется до нажатия «Войти», поэтому хватает любого.
  await page.goto('/join#превью-без-входа');
  await expect
    .poll(() => page.locator('video').evaluate(videoWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(2);
});
