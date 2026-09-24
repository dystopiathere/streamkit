import type { Locator, Page } from '@playwright/test';

/**
 * Разделы кабинета в шапке.
 *
 * Те же ссылки стоят картой в подвале, поэтому искать их по всей странице
 * нельзя: строгий режим Playwright находит две. `exact` — потому что «Разделы»
 * без него совпадает и с «Разделами профиля», и с «Разделами аналитики».
 */
export function mainNav(page: Page, name = 'Разделы'): Locator {
  return page.getByRole('navigation', { name, exact: true });
}

/** Раскрыть меню профиля под именем в шапке. */
export async function openProfileMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(Профиль|Profile): / }).click();
  // «Меню профиля», а не «Профиль»: так называется колонка карты в подвале.
  return page.getByRole('navigation', { name: /^(Меню профиля|Profile menu)$/ });
}

/** Перейти в раздел профиля — так, как это делает человек: через имя в шапке. */
export async function openProfileSection(page: Page, name: string): Promise<void> {
  const menu = await openProfileMenu(page);
  await menu.getByRole('link', { name, exact: true }).click();
}

/** «Выйти» — последний пункт меню профиля. */
export async function logout(page: Page): Promise<void> {
  await openProfileMenu(page);
  await page.getByRole('button', { name: /^(Выйти|Sign out)$/ }).click();
}
