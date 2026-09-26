import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS } from './legal-documents';
import { legalUpdateMessage } from './legal-update-mail';

describe('письмо о новых редакциях', () => {
  const input = {
    email: 'streamer@example.com',
    displayName: 'Стример',
    language: 'ru' as const,
    documents: [LEGAL_DOCUMENTS.TERMS, LEGAL_DOCUMENTS.PERSONAL_DATA],
    webBaseUrl: 'https://stream-kit.ru',
  };

  it('перечисляет документы со ссылками и датами редакций и говорит, что с каждым делать', () => {
    const message = legalUpdateMessage({
      ...input,
      documents: [
        { ...LEGAL_DOCUMENTS.TERMS, version: '2026-09-25.2' },
        LEGAL_DOCUMENTS.PERSONAL_DATA,
      ],
    });
    expect(message.subject).toBe('StreamKit: документы обновлены');
    expect(message.text).toContain(
      'Пользовательское соглашение (Редакция от 25 сентября 2026): https://stream-kit.ru/legal/terms',
    );
    expect(message.text).toContain('Подтвердите согласие в разделе «Приватность»');
    expect(message.text).toContain('заново принимать не нужно');
    expect(message.text).toContain('https://stream-kit.ru/account/privacy');
  });

  it('без согласий в списке не просит ничего подтверждать', () => {
    const message = legalUpdateMessage({ ...input, documents: [LEGAL_DOCUMENTS.PRIVACY] });
    expect(message.text).not.toContain('подтверждения');
  });

  it('по-английски — с английскими названиями и оговоркой о русской редакции', () => {
    const message = legalUpdateMessage({ ...input, language: 'en' });
    expect(message.text).toContain('Terms of Service');
    expect(message.text).toContain('binding version is the Russian one');
    expect(message.text).toContain('https://stream-kit.ru/legal/terms?lang=en');
  });
});
