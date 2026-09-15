import { formatMoney, PLAN_PRICES } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import { fillDocumentDetails, MISSING } from './seller';

describe('реквизиты и цены в тексте документа', () => {
  it('подставляет заполненные реквизиты', () => {
    const text = 'Продавец: {{SELLER_NAME}}, ИНН {{SELLER_INN}}, почта {{SELLER_EMAIL}}.';
    expect(
      fillDocumentDetails(text, {
        name: 'Иванов Иван Иванович',
        inn: '123456789012',
        email: 'support@example.ru',
        phone: null,
      }),
    ).toBe('Продавец: Иванов Иван Иванович, ИНН 123456789012, почта support@example.ru.');
  });

  it('незаполненное показывает явно, а не оставляет пустое место', () => {
    // Документ с «ИНН ,» выглядит как опечатка, а не как невнесённые реквизиты.
    expect(fillDocumentDetails('ИНН {{SELLER_INN}}', undefined)).toBe(`ИНН ${MISSING}`);
  });

  it('цены в оферте берутся из тарифа, а не вписываются руками', () => {
    expect(fillDocumentDetails('{{PRICE_MONTH}} / {{PRICE_YEAR}}', undefined)).toBe(
      `${formatMoney(PLAN_PRICES.month)} / ${formatMoney(PLAN_PRICES.year)}`,
    );
  });

  it('чужие метки не трогает', () => {
    expect(fillDocumentDetails('{{SELLER_UNKNOWN}} и {{OTHER}}', undefined)).toBe(
      '{{SELLER_UNKNOWN}} и {{OTHER}}',
    );
  });
});
