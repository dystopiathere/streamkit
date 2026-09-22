import { expect, test, type Page } from '@playwright/test';
import { buyPlan } from './plans';
import { connectYouTube } from './platforms';

/**
 * Виджеты, отличные от алертов, доходят до браузер-сорса.
 *
 * Проверяется ровно то, что не покрывают feature-тесты: собранный overlay
 * узнаёт ТИП виджета из bootstrap и выбирает нужный рендерер. До этого этапа
 * тип был один и в сообщении не передавался вовсе.
 *
 * Движение полосы цели сюда не входит: цель наполняют только настоящие донаты,
 * а тестовый алерт помечен `isTest` и в сумму намеренно не идёт. Эта развилка
 * проверяется интеграционным тестом, где событие можно засеять напрямую.
 */
async function registerStreamer(page: Page, prefix: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('E2E Виджеты');
  await page.getByLabel('Электронная почта').fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel('Пароль').fill('очень-надёжный-пароль-1');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/widgets$/);

  // Баннер согласия висит внизу поверх страницы и перехватывает клики по
  // кнопкам в нижней части формы. Выбираем «только необходимые» — тот же
  // выбор, который сделал бы осторожный пользователь. Появляется он после
  // загрузки журнала согласий, а не сразу, поэтому его приходится ждать.
  const banner = page.getByRole('button', { name: 'Только необходимые' });
  await banner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await banner.isVisible()) await banner.click();
}

async function issueOverlayUrl(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Настроить' }).first().click();
  await page.getByRole('button', { name: 'Создать ссылку' }).click();

  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });
  return field.inputValue();
}

test('цель отрисовывается в оверлее', async ({ page, context }) => {
  await registerStreamer(page, 'e2e-goal');

  await page.getByPlaceholder('Название виджета').fill('Цель на новый микрофон');
  await page.getByLabel('Тип виджета').selectOption('goal');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await expect(page.getByText('Цель на новый микрофон')).toBeVisible();

  const overlayUrl = await issueOverlayUrl(page);

  const overlayPage = await context.newPage();
  await overlayPage.goto(overlayUrl);

  await expect(overlayPage.getByTestId('goal-bar')).toBeVisible({ timeout: 15_000 });
  // Полоса пустая: настоящих донатов ещё не было, и выдумывать их нельзя.
  await expect(overlayPage.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('виджет чата настраивается, а оверлей по нему подключается', async ({ page, context }) => {
  // Сообщения сюда не доедут: их читает воркер, которого в сквозном прогоне
  // нет, а живой IRC в тесте — это зависимость от чужой сети. Путь «сокет →
  // JOIN → сообщение → шина» закрыт интеграционным тестом с поддельным
  // сервером. Здесь проверяется то, что тот тест увидеть не может: собранный
  // рендерер чата в настоящем браузере и приём токена оверлея виджетом чата.
  await registerStreamer(page, 'e2e-chat');

  // Без подключённой площадки виджету нечего показать, а вписать чужой канал
  // больше негде — создание отказывает с объяснением.
  await page.getByPlaceholder('Название виджета').fill('Чат в кадре');
  await page.getByLabel('Тип виджета').selectOption('chat');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await expect(page.getByText(/сначала подключите Twitch или YouTube/)).toBeVisible();

  // Хватает одной площадки — здесь только YouTube.
  const youtube = await connectYouTube(page);
  await page.getByRole('link', { name: 'Виджеты', exact: true }).click();
  await page.getByPlaceholder('Название виджета').fill('Чат в кадре');
  await page.getByLabel('Тип виджета').selectOption('chat');
  await page.getByRole('button', { name: 'Новый виджет' }).click();

  await page.getByRole('link', { name: 'Настроить' }).first().click();

  // Предпросмотр рисуется примером: настраивают чат до эфира, и пустая рамка
  // ничего не сказала бы ни про шрифт, ни про читаемость обводки.
  await expect(page.getByTestId('chat-box')).toBeVisible();
  await expect(page.getByTestId('chat-box')).toContainText('Модератор');

  // Поля канала нет: редактор называет подключённые каналы, и выбрать можно
  // только, чьи чаты показывать. Неподключённая площадка — ссылкой в «Аналитику».
  await expect(page.getByLabel('Канал Twitch')).toHaveCount(0);
  await expect(page.getByLabel(`Чат YouTube: ${youtube.title}`)).toBeChecked();
  await expect(page.getByText('Twitch не подключён.')).toBeVisible();

  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });

  const overlayPage = await context.newPage();
  await overlayPage.goto(await field.inputValue());

  // Экран пустой — сообщений ещё нет, и надпись поверх эфира не нужна. Зато
  // сервер обязан отметить подключение: значит, токен принят и оверлей вступил
  // в комнату канала.
  await page.reload();
  await expect(page.getByText('Последняя активность: не подключалась')).toHaveCount(0, {
    timeout: 15_000,
  });
  await overlayPage.close();
});

test('таймер запускается из дашборда и идёт в оверлее', async ({ page, context }) => {
  await registerStreamer(page, 'e2e-timer');

  await page.getByPlaceholder('Название виджета').fill('Марафон');
  await page.getByLabel('Тип виджета').selectOption('timer');
  await page.getByRole('button', { name: 'Новый виджет' }).click();

  const overlayUrl = await issueOverlayUrl(page);

  const overlayPage = await context.newPage();
  await overlayPage.goto(overlayUrl);
  await expect(overlayPage.getByTestId('timer-display')).toBeVisible({ timeout: 15_000 });

  // По умолчанию час и таймер стоит.
  await expect(overlayPage.getByTestId('timer-display')).toContainText('01:00:00');

  await page.getByRole('button', { name: 'Запустить' }).click();

  // Через две секунды отсчёт обязан уйти вниз: оверлей тикает сам, от
  // присланного момента окончания, а не ждёт сообщений с сервера.
  await expect
    .poll(async () => overlayPage.getByTestId('timer-display').textContent(), { timeout: 15_000 })
    .not.toContain('01:00:00');
});

/**
 * Продвинутое оформление доходит до кадра.
 *
 * Здесь проверяется то, чего не видит ни один другой тест: раскладка ставится в
 * браузере, уезжает в конфиг и применяется РЕНДЕРЕРОМ в собранном оверлее.
 * Интеграционный тест видит только конфиг, юнит-тест — только стили. Что без
 * «Про» оформление до кадра не доходит, проверяет интеграционный тест: там тариф
 * можно отобрать, не проходя оплату заново.
 */
test('переставленный заголовок цели оказывается в кадре там же', async ({ page, context }) => {
  test.setTimeout(90_000);
  const registered = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register'),
  );
  await registerStreamer(page, 'e2e-styling');
  const { accessToken } = (await (await registered).json()) as { accessToken: string };

  // Раскладка — в «Про»: без него блок оформления заблокирован.
  await buyPlan(page, accessToken, 'pro');

  await page.getByPlaceholder('Название виджета').fill('Цель с раскладкой');
  await page.getByLabel('Тип виджета').selectOption('goal');
  await page.getByRole('button', { name: 'Новый виджет' }).click();
  await page.getByRole('link', { name: 'Настроить «Цель с раскладкой»' }).click();

  await page.getByRole('tab', { name: /Раскладка/ }).click();
  // Клавиатурой, а не мышью: это и есть требование доступности — раскладка
  // обязана работать без указателя (и в тесте не зависит от размера кадра).
  const element = page.getByRole('button', { name: /Заголовок:/ });
  await element.click();
  // Под кадром — настройки ВЫБРАННОГО элемента: щелчок выбрал заголовок.
  await expect(element).toHaveAttribute('aria-pressed', 'true');
  // Первое нажатие ставит позицию от того места, где элемент нарисован, — оно
  // зависит от шрифта, поэтому шаги проверяются относительно него.
  await page.keyboard.press('ArrowRight');
  const x = page.getByLabel('По горизонтали, %');
  const y = page.getByLabel('По вертикали, %');
  const startX = Number(await x.inputValue());
  const startY = Number(await y.inputValue());
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Shift+ArrowLeft');
  for (let step = 0; step < 2; step += 1) await page.keyboard.press('Shift+ArrowDown');
  await expect(x).toHaveValue(String(Math.max(0, startX - 30)));
  await expect(y).toHaveValue(String(Math.min(100, startY + 20)));
  // Точное место — числом рядом с ползунком: так же, как это сделал бы стример.
  await x.fill('20');
  await x.press('Enter');
  await y.fill('40');
  await y.press('Enter');
  await expect(element).toHaveAttribute('aria-label', /20 % по горизонтали, 40 % по вертикали/);

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/widgets/') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  // «Сохранить» есть и у стартовой суммы цели: сохраняем именно настройки.
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await saved;

  // Ссылка выпускается здесь же: мы уже в редакторе, и возвращаться в список
  // виджетов ради чужого хелпера незачем.
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const field = page.locator('input[readonly]').first();
  await expect(field).toHaveValue(/token=/, { timeout: 10_000 });

  const overlayPage = await context.newPage();
  await overlayPage.goto(await field.inputValue());

  const title = overlayPage.getByTestId('goal-bar').getByText('Цель', { exact: true });
  await expect(title).toBeVisible({ timeout: 15_000 });
  // Позиция — проценты кадра с переносом на половину размера: элемент вынут из
  // потока, а не просто подкрашен.
  await expect(title).toHaveCSS('position', 'absolute');
  const box = await title.boundingBox();
  const frame = overlayPage.viewportSize()!;
  expect(box!.x + box!.width / 2).toBeLessThan(frame.width * 0.3);
  expect(box!.y + box!.height / 2).toBeGreaterThan(frame.height * 0.3);
});
