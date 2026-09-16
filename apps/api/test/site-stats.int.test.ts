import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceModule } from '../src/modules/maintenance/maintenance.module';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { LEGAL_DOCUMENTS } from '../src/modules/privacy/legal-documents';
import { createHarness, type TestHarness } from './harness';

const WEBSITE_ID = '6a0d6d57-8b3d-4a53-9d2b-0a6f2b1f7c11';
const UMAMI_SCHEMA = 'umami_purge_test';

// Окружение — до создания приложения: конфиг читает его при старте. База Umami
// в тесте — отдельная схема тестовой базы с таблицами, как у Umami 3.
process.env.UMAMI_WEBSITE_ID = WEBSITE_ID;
const umamiUrl = new URL(process.env.DATABASE_URL!);
umamiUrl.searchParams.set('options', `-c search_path=${UMAMI_SCHEMA}`);
process.env.UMAMI_DATABASE_URL = umamiUrl.toString();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Статистика посещений: настройки счётчика, журнал согласий посетителей без
 * учётной записи и срок хранения статистики, который Umami сам не держит.
 */
describe('Статистика посещений (feature)', () => {
  let harness: TestHarness;
  let umami: Client;

  beforeAll(async () => {
    harness = await createHarness([MaintenanceModule]);
    umami = new Client({ connectionString: process.env.DATABASE_URL });
    await umami.connect();
  });

  afterAll(async () => {
    await umami.query(`DROP SCHEMA IF EXISTS ${UMAMI_SCHEMA} CASCADE`);
    await umami.end();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    await umami.query(`DROP SCHEMA IF EXISTS ${UMAMI_SCHEMA} CASCADE`);
    // Только две таблицы из шести: остальные уборка обязана пропустить.
    await umami.query(`
      CREATE SCHEMA ${UMAMI_SCHEMA};
      CREATE TABLE ${UMAMI_SCHEMA}.session (session_id uuid PRIMARY KEY, created_at timestamptz);
      CREATE TABLE ${UMAMI_SCHEMA}.website_event (
        event_id uuid PRIMARY KEY, session_id uuid, created_at timestamptz
      );
    `);
  });

  const server = () => harness.app.getHttpServer();

  it('отдаёт идентификатор сайта без входа', async () => {
    const response = await request(server()).get('/api/public/site-stats').expect(200);
    expect(response.body).toEqual({ umamiWebsiteId: WEBSITE_ID });
  });

  it('записывает согласие посетителя с редакцией документа и отзывает его', async () => {
    const visitorId = randomUUID();
    await request(server())
      .post('/api/public/site-stats/consent')
      .set('User-Agent', 'StreamKitTest/1.0')
      .send({ visitorId })
      .expect(204);

    const [consent] = await harness.prisma.visitorConsent.findMany({ where: { visitorId } });
    expect(consent).toMatchObject({
      documentVersion: LEGAL_DOCUMENTS.COOKIE_ANALYTICS.version,
      userAgent: 'StreamKitTest/1.0',
      revokedAt: null,
    });
    expect(consent!.ipHash).toBeTruthy();

    await request(server())
      .post('/api/public/site-stats/consent/revoke')
      .send({ visitorId })
      .expect(204);
    const revoked = await harness.prisma.visitorConsent.findFirstOrThrow({ where: { visitorId } });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('не принимает выдуманный идентификатор посетителя', async () => {
    await request(server())
      .post('/api/public/site-stats/consent')
      .send({ visitorId: 'не-uuid' })
      .expect(400);
    expect(await harness.prisma.visitorConsent.count()).toBe(0);
  });

  it('уборка удаляет старые согласия посетителей', async () => {
    await harness.prisma.visitorConsent.createMany({
      data: [
        {
          visitorId: randomUUID(),
          documentVersion: 'v',
          grantedAt: new Date(Date.now() - 4 * 365 * DAY_MS),
        },
        { visitorId: randomUUID(), documentVersion: 'v' },
      ],
    });
    const maintenance = harness.app.get(MaintenanceService);
    expect(await maintenance.purgeOldVisitorConsents(3 * 365)).toBe(1);
    expect(await harness.prisma.visitorConsent.count()).toBe(1);
  });

  it('уборка статистики удаляет старые события и сессии, у которых событий не осталось', async () => {
    const old = new Date(Date.now() - 500 * DAY_MS);
    const fresh = new Date();
    const [staleSession, liveSession] = [randomUUID(), randomUUID()];
    await umami.query(`INSERT INTO ${UMAMI_SCHEMA}.session VALUES ($1, $3), ($2, $3)`, [
      staleSession,
      liveSession,
      old,
    ]);
    await umami.query(
      `INSERT INTO ${UMAMI_SCHEMA}.website_event VALUES ($1, $3, $5), ($2, $4, $6)`,
      [randomUUID(), randomUUID(), staleSession, liveSession, old, fresh],
    );

    const maintenance = harness.app.get(MaintenanceService);
    // Два удаления: старое событие и опустевшая сессия. Сессия с новым событием
    // остаётся, хотя сама старше срока.
    expect(await maintenance.purgeOldSiteStats(396)).toBe(2);
    const sessions = await umami.query(`SELECT session_id FROM ${UMAMI_SCHEMA}.session`);
    expect(sessions.rows.map((row: { session_id: string }) => row.session_id)).toEqual([
      liveSession,
    ]);
  });
});
