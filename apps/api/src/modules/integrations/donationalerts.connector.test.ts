import { describe, expect, it } from 'vitest';
import { DonationAlertsConnector } from './donationalerts.connector';

const userId = '00000000-0000-4000-8000-000000000001';

describe('DonationAlertsConnector.normalize', () => {
  const connector = new DonationAlertsConnector();

  it('переводит дробную сумму в целые копейки', () => {
    const event = connector.normalize(
      { id: 1, username: 'Вася', message: 'привет', amount: 100.5, currency: 'RUB' },
      userId,
    );

    expect(event.amount).toEqual({ amountMinor: 10_050, currency: 'RUB' });
  });

  it('корректно округляет суммы, неточные в плавающей точке', () => {
    const event = connector.normalize({ id: 2, amount: 19.99, currency: 'USD' }, userId);
    expect(event.amount?.amountMinor).toBe(1999);
  });

  it('принимает сумму строкой', () => {
    const event = connector.normalize({ id: 3, amount: '250.00', currency: 'RUB' }, userId);
    expect(event.amount?.amountMinor).toBe(25_000);
  });

  it('подставляет «Аноним» вместо пустого имени', () => {
    expect(
      connector.normalize({ id: 4, username: null, amount: 1, currency: 'RUB' }, userId).username,
    ).toBe('Аноним');
    expect(
      connector.normalize({ id: 5, username: '   ', amount: 1, currency: 'RUB' }, userId).username,
    ).toBe('Аноним');
  });

  it('не теряет событие из-за неизвестной валюты', () => {
    const event = connector.normalize({ id: 6, amount: 10, currency: 'GBP' }, userId);
    expect(event.amount?.currency).toBe('RUB');
  });

  it('приводит валюту к верхнему регистру', () => {
    const event = connector.normalize({ id: 7, amount: 10, currency: 'usd' }, userId);
    expect(event.amount?.currency).toBe('USD');
  });

  it('делает externalId строкой — от него зависит дедупликация', () => {
    expect(connector.normalize({ id: 42, amount: 1, currency: 'RUB' }, userId).externalId).toBe(
      '42',
    );
    expect(
      connector.normalize({ id: 'da-42', amount: 1, currency: 'RUB' }, userId).externalId,
    ).toBe('da-42');
  });

  it('подставляет пустое сообщение вместо null', () => {
    expect(
      connector.normalize({ id: 8, message: null, amount: 1, currency: 'RUB' }, userId).message,
    ).toBe('');
  });
});
