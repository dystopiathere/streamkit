import { expect, type Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

/**
 * Оплатить тариф стримеру — если оплата на сервере настроена.
 *
 * Через API и страницу подтверждения фальшивой ЮKassa, а не через интерфейс: сам
 * путь оплаты со страницами и согласием проверяет `billing.spec.ts`, а здесь
 * тариф нужен лишь как условие — без него закрыты приватные комнаты («Про») и
 * вторая площадка («Мультистрим»).
 *
 * Рядом с `pnpm dev` оплата может быть не настроена: тогда открыто всё и
 * платить нечем.
 */
export async function buyPlan(
  page: Page,
  accessToken: string,
  plan: 'multistream' | 'pro',
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const subscription = await page.request.get(`${API_URL}/api/billing/subscription`, { headers });
  const view = (await subscription.json()) as { billingConfigured: boolean; plan: string };
  if (!view.billingConfigured || view.plan === plan) return;

  const checkout = await page.request.post(`${API_URL}/api/billing/checkout`, {
    headers,
    data: { plan, period: 'month', acceptOffer: true },
  });
  expect(checkout.status()).toBe(201);
  const { confirmationUrl } = (await checkout.json()) as { confirmationUrl: string };
  await page.request.get(confirmationUrl, { maxRedirects: 0 });
  await expect
    .poll(async () => {
      const response = await page.request.get(`${API_URL}/api/billing/subscription`, { headers });
      return ((await response.json()) as { plan: string }).plan;
    })
    .toBe(plan);

  // Оплата прошла за спиной интерфейса, а кэш запросов держит ответ про тариф
  // полминуты (staleTime): страница виджетов спрашивает его ради лимита, и
  // соседняя страница комнат взяла бы из кэша ещё бесплатный тариф. Своя оплата
  // в дашборде кэш сбрасывает сама, но здесь её не было.
  await page.reload();
}
