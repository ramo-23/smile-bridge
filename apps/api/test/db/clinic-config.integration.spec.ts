import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import '../../src/database/data-source';
import { databaseEntities } from '../../src/database/entities';
import { UserRole } from '../../src/database/enums';
import { SnakeCaseNamingStrategy } from '../../src/database/snake-case-naming.strategy';
import { ExtensionsEnums1700000000001 } from '../../src/database/migrations/1700000000001-extensions-enums';
import { IdentityStaff1700000000002 } from '../../src/database/migrations/1700000000002-identity-staff';
import { Patients1700000000003 } from '../../src/database/migrations/1700000000003-patients';
import { Scheduling1700000000004 } from '../../src/database/migrations/1700000000004-scheduling';
import { Messaging1700000000005 } from '../../src/database/migrations/1700000000005-messaging';
import { Clinical1700000000006 } from '../../src/database/migrations/1700000000006-clinical';
import { Billing1700000000007 } from '../../src/database/migrations/1700000000007-billing';
import { Claims1700000000008 } from '../../src/database/migrations/1700000000008-claims';
import { SettingsAudit1700000000009 } from '../../src/database/migrations/1700000000009-settings-audit';
import { Triggers1700000000010 } from '../../src/database/migrations/1700000000010-triggers';
import { UpdatedAtTriggers1700000000011 } from '../../src/database/migrations/1700000000011-updated-at';
import { Sessions1700000000012 } from '../../src/database/migrations/1700000000012-sessions';
import { ClinicalEncrypted1700000000013 } from '../../src/database/migrations/1700000000013-clinical-encrypted';

const testDatabase = process.env.DB_TEST_DATABASE;
const developmentDatabase = process.env.DB_DATABASE ?? 'smile_bridge';
if (!testDatabase) throw new Error('DB_TEST_DATABASE is required; refusing DB integration tests.');
if (
  testDatabase === developmentDatabase ||
  testDatabase === 'smile_bridge' ||
  !/(^|[_-])test($|[_-])/i.test(testDatabase)
) {
  throw new Error(`Refusing destructive tests against non-test database "${testDatabase}".`);
}

const testDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_TEST_HOST ?? process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_TEST_PORT ?? process.env.DB_PORT ?? 5433),
  username: process.env.DB_TEST_USERNAME ?? process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_TEST_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres',
  database: testDatabase,
  entities: databaseEntities,
  namingStrategy: new SnakeCaseNamingStrategy(),
  migrationsTransactionMode: 'each',
  migrations: [
    ExtensionsEnums1700000000001,
    IdentityStaff1700000000002,
    Patients1700000000003,
    Scheduling1700000000004,
    Messaging1700000000005,
    Clinical1700000000006,
    Billing1700000000007,
    Claims1700000000008,
    SettingsAudit1700000000009,
    Triggers1700000000010,
    UpdatedAtTriggers1700000000011,
    Sessions1700000000012,
    ClinicalEncrypted1700000000013,
  ],
  synchronize: false,
});

const password = 'clinic config integration password';
let app: INestApplication;
let http: supertest.Agent;
let ownerId: string;
let receptionistId: string;
let inactiveOwnerId: string;
let ownerEmail: string;
let receptionistEmail: string;
let ownerCookie: string;
let receptionistCookie: string;

function cookieFrom(response: supertest.Response): string {
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('Login response did not set a session cookie');
  return cookie.split(';')[0]!;
}

function withSession(cookie: string, request: supertest.Test): supertest.Test {
  return request.set('Cookie', cookie).set('X-Requested-With', 'smile-bridge');
}

async function insertUser(
  role: UserRole,
  isActive = true,
): Promise<{ id: string; email: string }> {
  const email = `${role}-${randomUUID()}@example.invalid`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, 'Clinic Config User', $3, $4) RETURNING id, email`,
    [email, passwordHash, role, isActive],
  );
  return user;
}

async function login(email: string): Promise<string> {
  const response = await http
    .post('/auth/login')
    .set('X-Requested-With', 'smile-bridge')
    .send({ email, password })
    .expect(201);
  return cookieFrom(response);
}

const settingsBody = (overrides: Record<string, unknown> = {}) => ({
  clinicName: 'Maseru Dental',
  address: '1 Main Street',
  phone: '58123456',
  timezone: 'Africa/Maseru',
  currencyCode: 'LSL',
  bufferMinutes: 10,
  reminderHoursBefore: 24,
  ...overrides,
});

const treatmentBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Cleaning',
  procedureCode: 'D1110',
  defaultDurationMinutes: 30,
  defaultPriceCents: 12000,
  patientBookable: true,
  ...overrides,
});

async function createProvider(userId = ownerId) {
  return withSession(ownerCookie, http.post('/providers'))
    .send({ userId, displayName: 'Dr. Config' })
    .expect(201);
}

async function createTreatment(name = 'Cleaning') {
  return withSession(ownerCookie, http.post('/treatment-types'))
    .send(treatmentBody({ name }))
    .expect(201);
}

async function insertReadFixtures(): Promise<{ treatmentId: string; providerId: string }> {
  const [treatment] = await testDataSource.query(
    `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents)
     VALUES ('Read fixture', 30, 1000) RETURNING id`,
  );
  const [provider] = await testDataSource.query(
    `INSERT INTO providers (user_id, display_name) VALUES ($1, 'Read fixture') RETURNING id`,
    [ownerId],
  );
  return { treatmentId: treatment.id, providerId: provider.id };
}

beforeAll(async () => {
  await testDataSource.initialize();
  await testDataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
  await testDataSource.query('CREATE SCHEMA public');
  await testDataSource.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await testDataSource.runMigrations();

  process.env.DB_HOST = process.env.DB_TEST_HOST ?? process.env.DB_HOST ?? 'localhost';
  process.env.DB_PORT = process.env.DB_TEST_PORT ?? process.env.DB_PORT ?? '5433';
  process.env.DB_USERNAME = process.env.DB_TEST_USERNAME ?? process.env.DB_USERNAME ?? 'postgres';
  process.env.DB_PASSWORD = process.env.DB_TEST_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres';
  process.env.DB_DATABASE = testDatabase!;
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.DEFAULT_PHONE_REGION ??= 'LS';

  const owner = await insertUser(UserRole.DentistOwner);
  const receptionist = await insertUser(UserRole.Receptionist);
  const inactiveOwner = await insertUser(UserRole.DentistOwner, false);
  ownerId = owner.id;
  ownerEmail = owner.email;
  receptionistId = receptionist.id;
  receptionistEmail = receptionist.email;
  inactiveOwnerId = inactiveOwner.id;

  const { AppModule } = await import('../../src/app.module');
  const { NestFactory } = await import('@nestjs/core');
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  http = supertest(app.getHttpServer());
}, 120000);

beforeEach(async () => {
  await testDataSource.query(
    'TRUNCATE blocked_periods, working_hours, providers, treatment_types, clinic_settings, sessions, audit_log RESTART IDENTITY CASCADE',
  );
  http = supertest(app.getHttpServer());
  ownerCookie = await login(ownerEmail);
  receptionistCookie = await login(receptionistEmail);
});

afterAll(async () => {
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('clinic configuration', () => {
  it('allows authenticated reads to receptionists and denies every write to them and unauthenticated users', async () => {
    const { treatmentId, providerId } = await insertReadFixtures();
    const readPaths = [
      '/settings',
      '/treatment-types',
      `/treatment-types/${treatmentId}`,
      '/providers',
      `/providers/${providerId}/working-hours`,
      `/providers/${providerId}/blocked-periods`,
    ];
    for (const path of readPaths)
      await withSession(receptionistCookie, http.get(path)).expect(200);

    const writes = [
      () => withSession(receptionistCookie, http.put('/settings')).send(settingsBody()),
      () => withSession(receptionistCookie, http.post('/treatment-types')).send(treatmentBody()),
      () =>
        withSession(receptionistCookie, http.patch(`/treatment-types/${treatmentId}`)).send({
          isActive: false,
        }),
      () =>
        withSession(receptionistCookie, http.post('/providers')).send({
          userId: ownerId,
          displayName: 'Denied',
        }),
      () =>
        withSession(receptionistCookie, http.patch(`/providers/${providerId}`)).send({
          isActive: false,
        }),
      () =>
        withSession(receptionistCookie, http.put(`/providers/${providerId}/working-hours`)).send([]),
      () =>
        withSession(receptionistCookie, http.post(`/providers/${providerId}/blocked-periods`)).send({
          startsAt: '2026-05-01T09:00:00Z',
          endsAt: '2026-05-01T10:00:00Z',
        }),
      () =>
        withSession(
          receptionistCookie,
          http.delete(`/providers/${providerId}/blocked-periods/${randomUUID()}`),
        ),
    ];
    for (const write of writes) await write().expect(403);

    await http.get('/settings').expect(401);
    await http.put('/settings').send(settingsBody()).expect(401);
  });

  it('requires X-Requested-With on every write route', async () => {
    const { treatmentId, providerId } = await insertReadFixtures();
    const writes = [
      () => http.put('/settings').set('Cookie', ownerCookie).send(settingsBody()),
      () => http.post('/treatment-types').set('Cookie', ownerCookie).send(treatmentBody()),
      () =>
        http
          .patch(`/treatment-types/${treatmentId}`)
          .set('Cookie', ownerCookie)
          .send({ isActive: false }),
      () =>
        http
          .post('/providers')
          .set('Cookie', ownerCookie)
          .send({ userId: randomUUID(), displayName: 'No CSRF' }),
      () =>
        http
          .patch(`/providers/${providerId}`)
          .set('Cookie', ownerCookie)
          .send({ isActive: false }),
      () => http.put(`/providers/${providerId}/working-hours`).set('Cookie', ownerCookie).send([]),
      () =>
        http
          .post(`/providers/${providerId}/blocked-periods`)
          .set('Cookie', ownerCookie)
          .send({ startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T10:00:00Z' }),
      () =>
        http
          .delete(`/providers/${providerId}/blocked-periods/${randomUUID()}`)
          .set('Cookie', ownerCookie),
    ];
    for (const write of writes) await write().expect(403);
  });

  it('reads settings as unconfigured, upserts them, and rejects invalid timezone and currency', async () => {
    await withSession(ownerCookie, http.get('/settings')).expect(200, { configured: false });
    const saved = await withSession(ownerCookie, http.put('/settings'))
      .send(settingsBody())
      .expect(200);
    expect(saved.body).not.toHaveProperty('id');
    expect(saved.body).toMatchObject({
      clinicName: 'Maseru Dental',
      phone: '+26658123456',
      timezone: 'Africa/Maseru',
      currencyCode: 'LSL',
    });
    await withSession(ownerCookie, http.get('/settings'))
      .expect(200)
      .expect(({ body }) => expect(body.clinicName).toBe('Maseru Dental'));
    await withSession(ownerCookie, http.put('/settings'))
      .send(settingsBody({ timezone: 'Mars/Olympus' }))
      .expect(400);
    await withSession(ownerCookie, http.put('/settings'))
      .send(settingsBody({ currencyCode: 'usd' }))
      .expect(400);
  });

  it('enforces treatment-type uniqueness and duration increments and retains deactivated types', async () => {
    const created = await createTreatment('Scale and polish');
    await withSession(ownerCookie, http.post('/treatment-types'))
      .send(treatmentBody({ name: 'SCALE AND POLISH' }))
      .expect(409);
    await withSession(ownerCookie, http.post('/treatment-types'))
      .send(treatmentBody({ name: 'Invalid duration', defaultDurationMinutes: 32 }))
      .expect(400);
    const bookable = await withSession(ownerCookie, http.get('/treatment-types?patientBookable=true'))
      .expect(200);
    expect(bookable.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    const notBookable = await withSession(
      ownerCookie,
      http.get('/treatment-types?patientBookable=false'),
    ).expect(200);
    expect(notBookable.body.some((item: { id: string }) => item.id === created.body.id)).toBe(
      false,
    );

    await withSession(ownerCookie, http.patch(`/treatment-types/${created.body.id}`))
      .send({ isActive: false })
      .expect(200);
    const active = await withSession(ownerCookie, http.get('/treatment-types?activeOnly=true'))
      .expect(200);
    expect(active.body.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
    const all = await withSession(ownerCookie, http.get('/treatment-types')).expect(200);
    expect(all.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
  });

  it('only allows one active dentist-owner provider per user', async () => {
    await withSession(ownerCookie, http.post('/providers'))
      .send({ userId: receptionistId, displayName: 'Reception provider' })
      .expect(400);
    await withSession(ownerCookie, http.post('/providers'))
      .send({ userId: inactiveOwnerId, displayName: 'Inactive provider' })
      .expect(400);
    await createProvider();
    await withSession(ownerCookie, http.post('/providers'))
      .send({ userId: ownerId, displayName: 'Duplicate provider' })
      .expect(409);
  });

  it('replaces working hours atomically and rejects invalid, overlapping, touching, and inverted ranges', async () => {
    const provider = await createProvider();
    const path = `/providers/${provider.body.id}/working-hours`;
    await withSession(ownerCookie, http.put(path))
      .send([{ weekday: 1, startTime: '09:00', endTime: '12:00' }])
      .expect(200);

    await withSession(ownerCookie, http.put(path))
      .send([
        { weekday: 2, startTime: '09:00', endTime: '12:00' },
        { weekday: 2, startTime: '13:02', endTime: '17:00' },
      ])
      .expect(400);
    await withSession(ownerCookie, http.get(path)).expect(200, [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
    ]);

    for (const hours of [
      [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '13:00' },
      ],
      [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '12:00', endTime: '13:00' },
      ],
      [{ weekday: 1, startTime: '13:00', endTime: '12:00' }],
      [{ weekday: 1, startTime: '09:02', endTime: '12:00' }],
    ]) {
      await withSession(ownerCookie, http.put(path)).send(hours).expect(400);
    }

    const split = [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '13:00', endTime: '17:00' },
    ];
    await withSession(ownerCookie, http.put(path)).send(split).expect(200, split);
    await withSession(ownerCookie, http.get(path)).expect(200, split);
  });

  it('validates, filters, and deletes blocked periods', async () => {
    const provider = await createProvider();
    const path = `/providers/${provider.body.id}/blocked-periods`;
    await withSession(ownerCookie, http.post(path))
      .send({ startsAt: '2026-05-01T10:00:00+02:00', endsAt: '2026-05-01T09:00:00+02:00' })
      .expect(400);
    await withSession(ownerCookie, http.post(path))
      .send({ startsAt: '2026-05-01T09:00:00', endsAt: '2026-05-01T10:00:00Z' })
      .expect(400);
    await withSession(ownerCookie, http.post(path))
      .send({ startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-04-02T00:00:00Z' })
      .expect(400);

    const blocked = await withSession(ownerCookie, http.post(path))
      .send({
        startsAt: '2026-05-10T09:00:00+02:00',
        endsAt: '2026-05-10T10:00:00+02:00',
        reason: 'Training',
      })
      .expect(201);
    await withSession(ownerCookie, http.post(path))
      .send({ startsAt: '2026-06-10T09:00:00Z', endsAt: '2026-06-10T10:00:00Z' })
      .expect(201);

    const filtered = await withSession(
      ownerCookie,
      http.get(`${path}?from=2026-05-01&to=2026-05-31`),
    ).expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0]).toMatchObject({ id: blocked.body.id, reason: 'Training' });

    await withSession(ownerCookie, http.delete(`${path}/${blocked.body.id}`)).expect(200, {
      id: blocked.body.id,
      deleted: true,
    });
    const remaining = await withSession(ownerCookie, http.get(path)).expect(200);
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].reason).toBeNull();
    await withSession(ownerCookie, http.delete(`${path}/${blocked.body.id}`)).expect(404);
    await withSession(ownerCookie, http.delete(`${path}/${randomUUID()}`)).expect(404);
  });

  it('writes exactly one audit row per configuration mutation with field names only', async () => {
    await withSession(ownerCookie, http.put('/settings')).send(settingsBody()).expect(200);
    const treatment = await createTreatment('Audit treatment');
    await withSession(ownerCookie, http.patch(`/treatment-types/${treatment.body.id}`))
      .send({ isActive: false })
      .expect(200);
    const provider = await createProvider();
    await withSession(ownerCookie, http.patch(`/providers/${provider.body.id}`))
      .send({ displayName: 'Updated dentist', isActive: false })
      .expect(200);
    await withSession(ownerCookie, http.put(`/providers/${provider.body.id}/working-hours`))
      .send([{ weekday: 2, startTime: '09:00', endTime: '12:00' }])
      .expect(200);
    const blockedPath = `/providers/${provider.body.id}/blocked-periods`;
    const blocked = await withSession(ownerCookie, http.post(blockedPath))
      .send({
        startsAt: '2026-05-10T09:00:00Z',
        endsAt: '2026-05-10T10:00:00Z',
        reason: 'Audit reason secret',
      })
      .expect(201);
    await withSession(ownerCookie, http.delete(`${blockedPath}/${blocked.body.id}`)).expect(200);

    const actions = [
      'settings.update',
      'treatment_type.create',
      'treatment_type.update',
      'provider.create',
      'provider.update',
      'provider.working_hours.replace',
      'blocked_period.create',
      'blocked_period.delete',
    ];
    const auditRows = await testDataSource.query(
      'SELECT action, patient_id, metadata FROM audit_log WHERE action = ANY($1::text[]) ORDER BY action',
      [actions],
    );
    expect(auditRows).toHaveLength(actions.length);
    const changedFields: Record<string, string[]> = {
      'settings.update': [
        'clinicName',
        'address',
        'phone',
        'timezone',
        'currencyCode',
        'bufferMinutes',
        'reminderHoursBefore',
      ],
      'treatment_type.create': [
        'name',
        'procedureCode',
        'defaultDurationMinutes',
        'defaultPriceCents',
        'patientBookable',
        'isActive',
      ],
      'treatment_type.update': ['isActive'],
      'provider.create': ['userId', 'displayName'],
      'provider.update': ['displayName', 'isActive'],
      'provider.working_hours.replace': ['weekday', 'startTime', 'endTime'],
      'blocked_period.create': ['startsAt', 'endsAt', 'reason'],
      'blocked_period.delete': ['blockedPeriodId'],
    };
    for (const row of auditRows) {
      expect(row.patient_id).toBeNull();
      expect(row.metadata).toEqual({ changedFields: changedFields[row.action] });
      expect(JSON.stringify(row.metadata)).not.toContain('Maseru Dental');
      expect(JSON.stringify(row.metadata)).not.toContain('Audit treatment');
      expect(JSON.stringify(row.metadata)).not.toContain('Audit reason secret');
    }
  });
});
