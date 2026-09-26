import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER, type Mailer, type MailMessage } from '../src/common/mail/mailer';
import { LEGAL_DOCUMENTS } from '../src/modules/privacy/legal-documents';
import { LegalNoticesModule } from '../src/modules/privacy/legal-notices.module';
import { LegalUpdateNoticesService } from '../src/modules/privacy/legal-update-notices.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  configured = true;
  fail = false;

  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP недоступен');
    this.sent.push(message);
  }

  reset(): void {
    this.sent.length = 0;
    this.configured = true;
    this.fail = false;
  }
}

describe('Письма о новых редакциях документов (feature)', () => {
  let harness: TestHarness;
  let notices: LegalUpdateNoticesService;
  const mailer = new FakeMailer();

  beforeAll(async () => {
    harness = await createHarness([LegalNoticesModule], (builder) =>
      builder.overrideProvider(MAILER).useValue(mailer),
    );
    notices = harness.app.get(LegalUpdateNoticesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    mailer.reset();
  });

  async function register(overrides: Record<string, unknown> = {}) {
    const payload = registrationPayload(overrides);
    const response = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    return { email: payload.email, userId: response.body.user.id as string };
  }

  /** Отметка пользователя — как будто он принял прошлую редакцию. */
  async function outdate(userId: string, document: 'TERMS' | 'PERSONAL_DATA') {
    await harness.prisma.consent.updateMany({
      where: { userId, document },
      data: { documentVersion: '2026-01-01' },
    });
  }

  it('принявшим прежнюю редакцию — одно письмо на все изменившиеся документы', async () => {
    const user = await register();
    await outdate(user.userId, 'TERMS');
    await outdate(user.userId, 'PERSONAL_DATA');
    await register();

    expect(await notices.sendPending()).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    const letter = mailer.sent[0]!;
    expect(letter.to).toBe(user.email);
    expect(letter.text).toContain(LEGAL_DOCUMENTS.TERMS.title);
    expect(letter.text).toContain(LEGAL_DOCUMENTS.PERSONAL_DATA.title);
    expect(letter.text).not.toContain(LEGAL_DOCUMENTS.PRIVACY.title);
    // Согласие по 152-ФЗ просят подтвердить, соглашение — нет.
    expect(letter.text).toContain('Подтвердите согласие в разделе «Приватность»');
    expect(letter.text).toContain('заново принимать не нужно');

    expect(await notices.sendPending()).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it('отметившим новую редакцию в баннере писем нет', async () => {
    const user = await register();
    await outdate(user.userId, 'TERMS');
    await harness.prisma.consent.create({
      data: {
        userId: user.userId,
        document: 'TERMS',
        documentVersion: LEGAL_DOCUMENTS.TERMS.version,
      },
    });

    expect(await notices.sendPending()).toBe(0);
  });

  it('отозвавшим согласие подтверждать нечего', async () => {
    const user = await register();
    await harness.prisma.consent.create({
      data: {
        userId: user.userId,
        document: 'COOKIE_ANALYTICS',
        documentVersion: '2026-01-01',
        revokedAt: new Date(),
      },
    });

    expect(await notices.sendPending()).toBe(0);
  });

  it('пишет на языке аккаунта', async () => {
    const user = await register({ language: 'en' });
    await outdate(user.userId, 'TERMS');

    expect(await notices.sendPending()).toBe(1);
    expect(mailer.sent[0]!.subject).toBe('StreamKit: documents updated');
    expect(mailer.sent[0]!.html).toContain('/legal/terms?lang=en');
  });

  it('сбой почты — письмо уходит следующим тактом', async () => {
    const user = await register();
    await outdate(user.userId, 'TERMS');
    mailer.fail = true;
    expect(await notices.sendPending()).toBe(0);
    expect(await harness.prisma.legalUpdateNotice.count()).toBe(0);

    mailer.fail = false;
    expect(await notices.sendPending()).toBe(1);
  });

  it('заблокированным не пишет', async () => {
    const user = await register();
    await outdate(user.userId, 'TERMS');
    await harness.prisma.user.update({ where: { id: user.userId }, data: { status: 'SUSPENDED' } });

    expect(await notices.sendPending()).toBe(0);
  });
});
