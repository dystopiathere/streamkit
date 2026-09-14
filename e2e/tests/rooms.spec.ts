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

const API_URL = 'http://localhost:3000';

/** Регистрирует стримера и возвращает его access-токен — для проверок через API. */
async function registerStreamer(page: Page): Promise<string> {
  const registered = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register'),
  );
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
  return ((await (await registered).json()) as { accessToken: string }).accessToken;
}

/** Комната с одним приглашением. Стример остаётся на странице комнаты. */
async function roomWithInvite(page: Page): Promise<{ roomId: string; inviteUrl: string }> {
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await page.getByPlaceholder('Название комнаты').fill('Вечерний эфир');
  await page.getByRole('button', { name: 'Новая комната' }).click();
  await page.getByRole('link', { name: 'Открыть' }).click();
  const roomId = new URL(page.url()).pathname.split('/').pop()!;

  await page.getByPlaceholder('Кому ссылка').fill('Гость подкаста');
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const inviteField = page.getByRole('textbox', { name: 'Приглашения' });
  await expect(inviteField).toHaveValue(/\/join#/, { timeout: 10_000 });
  return { roomId, inviteUrl: await inviteField.inputValue() };
}

async function joinAsGuest(guest: Page, inviteUrl: string): Promise<void> {
  // Адрес, отличающийся только фрагментом, `goto` не перезагружает: это
  // навигация внутри документа. Повторный вход — через настоящую перезагрузку.
  if (guest.url() === inviteUrl) await guest.reload();
  else await guest.goto(inviteUrl);
  await guest.getByLabel('Ваше имя').fill('Вася');
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();
  await expect(guest.getByText('Вы в комнате «Вечерний эфир»')).toBeVisible({ timeout: 15_000 });
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
  // Виджет без комнаты подключался и молча оставался пустым — так выглядела
  // первая ручная проверка. Теперь пустое поле подсвечено прямо в редакторе.
  const roomMissing = page.getByRole('alert').filter({ hasText: 'Комната не выбрана' });
  await expect(roomMissing).toBeVisible();
  await page.getByLabel('Комната').selectOption({ label: 'Вечерний эфир' });
  await expect(roomMissing).toHaveCount(0);
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

test('выключенный стримером микрофон гость не включит сам — ни кнопкой, ни перезагрузкой', async ({
  page,
  browser,
  request,
}) => {
  // Раньше «заглушить» ставило дорожке флаг, а гость снимал его той же кнопкой
  // микрофона. Теперь сервер отнимает право: дорожка снимается с публикации,
  // а запрет живёт на ссылке и переживает перезагрузку вкладки.
  test.setTimeout(120_000);
  const accessToken = await registerStreamer(page);
  const { roomId, inviteUrl } = await roomWithInvite(page);
  await page.getByRole('button', { name: 'Войти в комнату' }).click();

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guest = await guestContext.newPage();
  await joinAsGuest(guest, inviteUrl);
  await expect(guest.getByRole('button', { name: /Микрофон: вкл/ })).toBeVisible({
    timeout: 15_000,
  });

  const guestAudioTracks = async (): Promise<number> => {
    const response = await request.get(`${API_URL}/api/rooms/${roomId}/participants`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const participants = (await response.json()) as Array<{
      role: string;
      tracks: Array<{ kind: string }>;
    }>;
    return participants
      .filter((participant) => participant.role === 'guest')
      .flatMap((participant) => participant.tracks)
      .filter((track) => track.kind === 'audio').length;
  };
  await expect.poll(guestAudioTracks, { timeout: 15_000 }).toBe(1);

  const guestTile = page.getByTestId('room-tile').filter({ hasText: 'Вася' });
  await guestTile.getByRole('button', { name: 'Выключить микрофон' }).click();

  await expect(guest.getByRole('button', { name: 'Микрофон выключен стримером' })).toBeDisabled({
    timeout: 10_000,
  });
  // Проверка на сервере, а не в интерфейсе гостя: дорожки нет вовсе, включать нечего.
  await expect.poll(guestAudioTracks, { timeout: 10_000 }).toBe(0);
  await expect(guestTile.getByRole('button', { name: 'Разрешить микрофон' })).toBeVisible();

  // Перезагрузка вкладки запрет не снимает.
  await joinAsGuest(guest, inviteUrl);
  await expect(guest.getByRole('button', { name: 'Микрофон выключен стримером' })).toBeDisabled({
    timeout: 15_000,
  });
  expect(await guestAudioTracks()).toBe(0);

  // Разрешение возвращает право, но микрофон гость включает сам.
  await page
    .getByTestId('room-tile')
    .filter({ hasText: 'Вася' })
    .getByRole('button', { name: 'Разрешить микрофон' })
    .click();
  const micButton = guest.getByRole('button', { name: /Микрофон: выкл/ });
  await expect(micButton).toBeEnabled({ timeout: 10_000 });
  await micButton.click();
  await expect.poll(guestAudioTracks, { timeout: 10_000 }).toBe(1);

  await guestContext.close();
});

test('камера после выключения включается без повторного открытия устройства', async ({
  page,
  browser,
}) => {
  // Стандартное выключение в livekit-client закрывает устройство, и включение
  // открывало его заново — у настоящей вебкамеры это секунды чёрного кадра. На
  // фальшивой камере задержки не видно, поэтому проверяется причина, а не
  // время: сколько раз страница открывала камеру.
  test.setTimeout(120_000);
  await registerStreamer(page);
  const { inviteUrl } = await roomWithInvite(page);
  await page.getByRole('button', { name: 'Войти в комнату' }).click();

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await guestContext.addInitScript(() => {
    // Пакет тестов собирается без DOM-типов: скрипт исполняется в браузере.
    type Constraints = { video?: unknown };
    const scope = globalThis as unknown as {
      cameraOpened: number;
      navigator: { mediaDevices: { getUserMedia: (c?: Constraints) => Promise<unknown> } };
    };
    const devices = scope.navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    scope.cameraOpened = 0;
    devices.getUserMedia = (constraints?: Constraints) => {
      if (constraints?.video) scope.cameraOpened += 1;
      return original(constraints);
    };
  });
  const guest = await guestContext.newPage();
  await joinAsGuest(guest, inviteUrl);

  const hostVideo = page.getByTestId('room-tile').filter({ hasText: 'Вася' }).locator('video');
  await expect
    .poll(() => hostVideo.evaluate(videoWidth).catch(() => 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const openedAfterJoin = await guest.evaluate(
    () => (globalThis as unknown as { cameraOpened: number }).cameraOpened,
  );

  await guest.getByRole('button', { name: /Камера: вкл/ }).click();
  await expect(hostVideo).toHaveCount(0, { timeout: 10_000 });
  await guest.getByRole('button', { name: /Камера: выкл/ }).click();
  await expect
    .poll(() => hostVideo.evaluate(videoWidth).catch(() => 0), { timeout: 15_000 })
    .toBeGreaterThan(0);

  expect(
    await guest.evaluate(() => (globalThis as unknown as { cameraOpened: number }).cameraOpened),
  ).toBe(openedAfterJoin);

  await guestContext.close();
});

test('виджет, созданный со страницы комнаты, сразу к ней привязан', async ({ page }) => {
  // Путь через раздел «Виджеты» требовал выбрать комнату в редакторе, и этот шаг
  // легко пропустить: виджет без комнаты молча ничего не показывает.
  await registerStreamer(page);
  await roomWithInvite(page);

  await page.getByRole('button', { name: 'Создать виджет для этой комнаты' }).click();
  await expect(page).toHaveURL(/\/widgets\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Комната')).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByRole('alert').filter({ hasText: 'Комната не выбрана' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Комнаты' }).click();
  await page.getByRole('link', { name: 'Открыть' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Вечерний эфир' })).toBeVisible();

  // Удалённая комната виджет не отвязывает: в конфиге остаётся её идентификатор.
  // Редактор обязан сказать об этом так же, как о невыбранной комнате.
  const widgetLink = page
    .getByRole('listitem')
    .filter({ hasText: 'Вечерний эфир' })
    .getByRole('link');
  const widgetPath = await widgetLink.getAttribute('href');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('link', { name: 'Комнаты' }).click();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('link', { name: 'Открыть' })).toHaveCount(0);
  await page.goto(widgetPath!);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Комната этого виджета удалена' }),
  ).toBeVisible();
});

test('гость, удалённый с отзывом ссылки, не входит обратно сохранённым токеном', async ({
  page,
  browser,
  request,
}) => {
  // Выданный токен LiveKit не отзывается: revokeTokenTs в LiveKit 1.13 не
  // действует, и удалённый гость входил обратно тем же токеном, пока тот не
  // истёк. Теперь о каждом входе LiveKit сообщает API вебхуком, а API выгоняет
  // того, чья ссылка отозвана. Здесь гость «вытащил» токен из вкладки: при
  // повторном входе ему подсовывается прежний ответ сервера целиком.
  test.setTimeout(120_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const accessToken = await registerStreamer(page);
  const { roomId, inviteUrl } = await roomWithInvite(page);
  await page.getByRole('button', { name: 'Войти в комнату' }).click();

  const guestsInRoom = async (): Promise<number> => {
    const response = await request.get(`${API_URL}/api/rooms/${roomId}/participants`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const participants = (await response.json()) as Array<{ role: string }>;
    return participants.filter((participant) => participant.role === 'guest').length;
  };

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guest = await guestContext.newPage();
  const joined = guest.waitForResponse((response) => response.url().includes('/api/rooms/join'));
  await joinAsGuest(guest, inviteUrl);
  const savedAccess = await (await joined).text();
  await expect.poll(guestsInRoom, { timeout: 15_000 }).toBe(1);

  await page
    .getByTestId('room-tile')
    .filter({ hasText: 'Вася' })
    .getByRole('button', { name: 'Удалить и отозвать ссылку' })
    .click();
  await expect.poll(guestsInRoom, { timeout: 15_000 }).toBe(0);

  // Перезагрузка сбрасывает надпись о первом удалении: дальше она может
  // появиться только от нового — то есть если гость действительно вошёл
  // старым токеном и был выгнан.
  await guest.reload();
  await guest.getByLabel('Ваше имя').fill('Вася');
  await expect(guest.getByText('Стример удалил вас из комнаты.')).toHaveCount(0);
  await guest.route('**/api/rooms/join', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: savedAccess }),
  );
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();

  // Старый токен LiveKit пускает — и через мгновение вебхук выгоняет. Проверяем
  // не «ни разу не вошёл», а «в комнате не остался».
  await expect(guest.getByText('Стример удалил вас из комнаты.')).toBeVisible({ timeout: 15_000 });
  await expect.poll(guestsInRoom, { timeout: 15_000 }).toBe(0);

  await guestContext.close();
});

test('обработка голоса доходит до захвата микрофона и не открывает выключенный микрофон', async ({
  page,
  browser,
  request,
}) => {
  // Браузер по умолчанию давит шум, эхо и выравнивает громкость — хорошему
  // микрофону это вредит. Проверяется не интерфейс, а то, с какими параметрами
  // страница реально открыла микрофон, и что увидел сервер.
  test.setTimeout(120_000);
  const accessToken = await registerStreamer(page);
  const { roomId, inviteUrl } = await roomWithInvite(page);
  await page.getByRole('button', { name: 'Войти в комнату' }).click();

  type Capture = {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await guestContext.addInitScript(() => {
    type Track = { kind: string; getSettings: () => Record<string, unknown> };
    const scope = globalThis as unknown as {
      audioCaptures: Array<Record<string, unknown>>;
      navigator: {
        mediaDevices: {
          getUserMedia: (c?: { audio?: unknown }) => Promise<{ getTracks: () => Track[] }>;
        };
      };
    };
    const devices = scope.navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    scope.audioCaptures = [];
    devices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      for (const track of stream.getTracks()) {
        if (track.kind === 'audio') scope.audioCaptures.push(track.getSettings());
      }
      return stream;
    };
  });
  const guest = await guestContext.newPage();
  const captures = (): Promise<Capture[]> =>
    guest.evaluate(() => (globalThis as unknown as { audioCaptures: Capture[] }).audioCaptures);
  const lastCapture = async (): Promise<Capture | undefined> => (await captures()).at(-1);

  const guestAudio = async (): Promise<Array<{ sid: string; muted: boolean }>> => {
    const response = await request.get(`${API_URL}/api/rooms/${roomId}/participants`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const participants = (await response.json()) as Array<{
      role: string;
      tracks: Array<{ sid: string; kind: string; muted: boolean }>;
    }>;
    return participants
      .filter((participant) => participant.role === 'guest')
      .flatMap((participant) => participant.tracks)
      .filter((track) => track.kind === 'audio');
  };

  // Уровень выбирается до входа и действует на первую же публикацию.
  await guest.goto(inviteUrl);
  await guest.locator('summary', { hasText: 'Обработка голоса' }).click();
  await guest.getByRole('radio', { name: /^Без обработки/ }).check();
  await guest.getByLabel('Ваше имя').fill('Вася');
  await guest.getByLabel(/Я принимаю/).check();
  await guest.getByRole('button', { name: 'Войти' }).click();
  await expect(guest.getByRole('button', { name: /Микрофон: вкл/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(async () => (await guestAudio()).length, { timeout: 15_000 }).toBe(1);
  expect(await lastCapture()).toMatchObject({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });

  // Смена качества передачи — новая публикация, звук идёт дальше.
  await guest.getByRole('button', { name: 'Обработка голоса' }).click();
  const firstSid = (await guestAudio())[0]!.sid;
  await guest.getByRole('radio', { name: /^Полная/ }).check();
  await expect
    .poll(async () => (await guestAudio())[0]?.sid, { timeout: 15_000 })
    .not.toBe(firstSid);
  expect((await guestAudio())[0]!.muted).toBe(false);
  expect(await lastCapture()).toMatchObject({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  // Смена только обработки — перезахват в той же публикации: у собеседников
  // звук не пропадает.
  const publishedSid = (await guestAudio())[0]!.sid;
  const capturedBefore = (await captures()).length;
  await guest.getByRole('checkbox', { name: /^Автоусиление/ }).uncheck();
  await expect
    .poll(async () => (await captures()).length, { timeout: 10_000 })
    .toBe(capturedBefore + 1);
  expect(await lastCapture()).toMatchObject({ autoGainControl: false, echoCancellation: true });
  expect((await guestAudio()).map((track) => track.sid)).toEqual([publishedSid]);
  await expect(guest.getByText('Своя настройка', { exact: false })).toBeVisible();

  // Выключенный микрофон смена качества не открывает: дорожка снимается и ждёт
  // кнопки, а не публикуется заново на миг.
  await guest.getByRole('button', { name: /Микрофон: вкл/ }).click();
  await expect.poll(async () => (await guestAudio())[0]?.muted, { timeout: 10_000 }).toBe(true);
  await guest.getByRole('radio', { name: /^Без обработки/ }).check();
  await expect.poll(async () => (await guestAudio()).length, { timeout: 10_000 }).toBe(0);
  await expect(guest.getByRole('button', { name: /Микрофон: выкл/ })).toBeVisible();

  await guest.getByRole('button', { name: /Микрофон: выкл/ }).click();
  await expect
    .poll(async () => (await guestAudio()).filter((track) => !track.muted).length, {
      timeout: 10_000,
    })
    .toBe(1);
  expect(await lastCapture()).toMatchObject({ echoCancellation: false, noiseSuppression: false });

  await guestContext.close();
});
