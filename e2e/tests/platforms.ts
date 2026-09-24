import { expect, type Page } from '@playwright/test';
import { openProfileSection } from './navigation';

/**
 * Подключить Twitch так, как это делает стример: профиль, раздел «Площадки»,
 * вход на площадке (фальшивой, `fake-twitch.mjs`), возврат в дашборд.
 *
 * Фальшивый Twitch выдаёт на каждый вход новый канал, поэтому логин читается
 * с карточки канала, а не задаётся тестом.
 *
 * @returns логин подключённого канала — его чат покажут виджет и окно эфира.
 */
export async function connectTwitch(page: Page): Promise<string> {
  await openProfileSection(page, 'Площадки');
  await page.getByRole('button', { name: 'Подключить Twitch' }).click();
  await expect(page).toHaveURL(/\/account\/platforms/);

  const card = page.getByText(/Twitch · e2e_streamer_\d+/).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const login = /e2e_streamer_\d+/.exec((await card.textContent()) ?? '')?.[0];
  if (!login) throw new Error('Логин подключённого канала не найден');
  return login;
}

/**
 * Подключить YouTube так же, через фальшивый вход Google (`fake-youtube.mjs`).
 *
 * На карточке канала — адрес `@e2e_yt_N`, а чат адресуется id канала `UC…`:
 * его фальшивый YouTube строит из того же номера.
 *
 * @returns id канала YouTube и его название — так канал подписан в окне эфира.
 */
export async function connectYouTube(page: Page): Promise<{ channel: string; title: string }> {
  await openProfileSection(page, 'Площадки');
  await page.getByRole('button', { name: 'Подключить YouTube' }).click();
  await expect(page).toHaveURL(/\/account\/platforms/);

  const card = page.getByText(/YouTube · @e2e_yt_\d+/).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const n = /@e2e_yt_(\d+)/.exec((await card.textContent()) ?? '')?.[1];
  if (!n) throw new Error('Канал YouTube не найден');
  return { channel: `UCe2e_yt_${n.padStart(15, '0')}`, title: `E2E YouTube ${n}` };
}
