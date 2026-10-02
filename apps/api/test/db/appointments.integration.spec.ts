import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DateTime, Settings } from 'luxon';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import '../../src/database/data-source';
import { databaseEntities } from '../../src/database/entities';
import { AppointmentSource, AppointmentStatus, UserRole } from '../../src/database/enums';
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
import { DocumentCounters1700000000014 } from '../../src/database/migrations/1700000000014-document-counters';

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
    DocumentCounters1700000000014,
  ],
  synchronize: false,
});

const originalLuxonNow = Settings.now;
const password = 'appointments integration password';
let app: INestApplication;
let http: supertest.Agent;
let ownerId: string;
let receptionistId: string;
let secondOwnerId: string;
let ownerEmail: string;
let receptionistEmail: string;
let ownerCookie: string;
let receptionistCookie: string;
let providerId: string;
let secondProviderUserId: string;
let treatmentTypeId: string;
let patientId: string;
let patientCounter = 0;

function setNow(value: string) {
  const millis = DateTime.fromISO(value, { setZone: true }).toMillis();
  Settings.now = () => millis;
}

function localTime(day: string, time: string): string {
  return DateTime.fromISO(`${day}T${time}`, { zone: 'Africa/Maseru' }).toISO()!;
}

function cookieFrom(response: supertest.Response): string {
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('Login response did not set a session cookie');
  return cookie.split(';')[0]!;
}

function owner(request: supertest.Test): supertest.Test {
  return request.set('Cookie', ownerCookie).set('X-Requested-With', 'smile-bridge');
}

function receptionist(request: supertest.Test): supertest.Test {
  return request.set('Cookie', receptionistCookie).set('X-Requested-With', 'smile-bridge');
}

function appointmentBody(overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    providerId,
    treatmentTypeId,
    startsAt: localTime('2026-01-05', '10:00'),
    ...overrides,
  };
}

async function createPatient(name = 'Ada Lovelace'): Promise<string> {
  patientCounter += 1;
  const [patient] = await testDataSource.query(
    `INSERT INTO patients (first_name, last_name, date_of_birth, phone_e164, created_by)
     VALUES ($1, $2, '1990-04-12', $3, $4) RETURNING id`,
    [name.split(' ')[0], name.split(' ').slice(1).join(' '), `+2665812${String(patientCounter).padStart(4, '0')}`, ownerId],
  );
  return patient.id as string;
}

async function createAppointment(overrides: Record<string, unknown> = {}) {
  return owner(http.post('/appointments')).send(appointmentBody(overrides)).expect(201);
}

async function expectConflict(request: supertest.Test, message: string) {
  const response = await request.expect(409);
  expect(Array.isArray(response.body.message)).toBe(true);
  expect(response.body.message.join(' ')).toContain(message);
  expect(response.body.alternatives).toEqual(expect.any(Array));
  expect(response.body.alternatives.length).toBeLessThanOrEqual(3);
  return response;
}

async function insertHours(
  targetProviderId = providerId,
  hours: Array<{ weekday: number; start: string; end: string }> = [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '13:00', end: '17:00' },
    { weekday: 2, start: '09:00', end: '12:00' },
    { weekday: 2, start: '13:00', end: '17:00' },
    { weekday: 3, start: '09:00', end: '12:00' },
    { weekday: 3, start: '13:00', end: '17:00' },
    { weekday: 4, start: '09:00', end: '12:00' },
    { weekday: 4, start: '13:00', end: '17:00' },
    { weekday: 5, start: '09:00', end: '12:00' },
    { weekday: 5, start: '13:00', end: '17:00' },
    { weekday: 6, start: '09:00', end: '12:00' },
    { weekday: 6, start: '13:00', end: '17:00' },
    { weekday: 0, start: '09:00', end: '12:00' },
    { weekday: 0, start: '13:00', end: '17:00' },
  ],
) {
  for (const hour of hours) {
    await testDataSource.query(
      'INSERT INTO working_hours (provider_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)',
      [targetProviderId, hour.weekday, hour.start, hour.end],
    );
  }
}

async function insertProvider(userId: string) {
  const [provider] = await testDataSource.query(
    'INSERT INTO providers (user_id, display_name) VALUES ($1, $2) RETURNING id',
    [userId, `Provider ${userId.slice(0, 5)}`],
  );
  return provider.id as string;
}

async function insertUser(role: UserRole, active = true) {
  const email = `${role}-${randomUUID()}@example.invalid`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, 'Scheduler Test User', $3, $4) RETURNING id`,
    [email, hash, role, active],
  );
  return { id: user.id as string, email };
}

async function login(email: string): Promise<string> {
  const response = await http
    .post('/auth/login')
    .set('X-Requested-With', 'smile-bridge')
    .send({ email, password })
    .expect(201);
  return cookieFrom(response);
}

async function settle(test: supertest.Test): Promise<supertest.Response> {
  try {
    return await test;
  } catch (error) {
    const response = (error as { response?: supertest.Response }).response;
    if (response) return response;
    throw error;
  }
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

  const ownerUser = await insertUser(UserRole.DentistOwner);
  const receptionistUser = await insertUser(UserRole.Receptionist);
  const secondOwner = await insertUser(UserRole.DentistOwner);
  ownerId = ownerUser.id;
  ownerEmail = ownerUser.email;
  receptionistId = receptionistUser.id;
  receptionistEmail = receptionistUser.email;
  secondOwnerId = secondOwner.id;
  secondProviderUserId = secondOwner.id;

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
  setNow('2026-01-01T08:00:00Z');
  await testDataSource.query(
    `TRUNCATE appointments, blocked_periods, working_hours, providers, treatment_types,
     clinic_settings, patients, sessions, audit_log RESTART IDENTITY CASCADE`,
  );
  await testDataSource.query(
    `INSERT INTO clinic_settings (id, clinic_name, timezone, currency_code, buffer_minutes, reminder_hours_before)
     VALUES (true, 'Scheduler Clinic', 'Africa/Maseru', 'LSL', 10, 24)`,
  );
  providerId = await insertProvider(ownerId);
  const [treatment] = await testDataSource.query(
    `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents, patient_bookable, is_active)
     VALUES ('Consultation', 30, 5000, true, true) RETURNING id`,
  );
  treatmentTypeId = treatment.id as string;
  patientId = await createPatient();
  await insertHours();
  http = supertest(app.getHttpServer());
  ownerCookie = await login(ownerEmail);
  receptionistCookie = await login(receptionistEmail);
});

afterAll(async () => {
  Settings.now = originalLuxonNow;
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('appointment scheduler', () => {
  it('creates a valid appointment with absolute timestamps and the configured buffer', async () => {
    const response = await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    expect(response.body).toMatchObject({
      patientId,
      providerId,
      treatmentTypeId,
      status: AppointmentStatus.Scheduled,
      source: AppointmentSource.Staff,
    });
    expect(DateTime.fromISO(response.body.startsAt).setZone('Africa/Maseru').toFormat('HH:mm')).toBe(
      '09:00',
    );
    expect(DateTime.fromISO(response.body.endsAt).diff(DateTime.fromISO(response.body.startsAt), 'minutes').minutes).toBe(30);
    expect(DateTime.fromISO(response.body.blockedUntil).diff(DateTime.fromISO(response.body.endsAt), 'minutes').minutes).toBe(10);
  });

  it('returns appointment timestamps as ISO 8601 strings with the clinic timezone offset', async () => {
    const response = await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    expect(response.body.startsAt).toMatch(/\+02:00$/);
    expect(response.body.endsAt).toMatch(/\+02:00$/);
    expect(response.body.blockedUntil).toMatch(/\+02:00$/);
    expect(response.body.startsAt).not.toMatch(/Z$/);

    const list = await owner(
      http.get(
        `/appointments?from=${encodeURIComponent(localTime('2026-01-05', '00:00'))}&to=${encodeURIComponent(localTime('2026-01-06', '00:00'))}`,
      ),
    ).expect(200);
    expect(list.body[0].startsAt).toMatch(/\+02:00$/);

    const fetched = await owner(http.get(`/appointments/${response.body.id}`)).expect(200);
    expect(fetched.body.startsAt).toMatch(/\+02:00$/);
  });

  it('audits only the fields supplied in the request body for create, reschedule, and walk-in', async () => {
    const created = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    await owner(http.patch(`/appointments/${created.body.id}`))
      .send({ startsAt: localTime('2026-01-05', '11:00') })
      .expect(200);
    setNow('2026-01-05T07:01:00Z');
    await owner(http.post('/appointments/walk-in'))
      .send({ patientId, providerId, treatmentTypeId })
      .expect(201);

    const rows = await testDataSource.query(
      `SELECT action, metadata FROM audit_log
       WHERE action IN ('appointment.create', 'appointment.update', 'appointment.walk_in')
       ORDER BY id`,
    );
    const [createRow, updateRow, walkInRow] = rows;
    expect([...createRow.metadata.changedFields].sort()).toEqual(
      ['patientId', 'providerId', 'treatmentTypeId', 'startsAt'].sort(),
    );
    expect(updateRow.metadata.changedFields).toEqual(['startsAt']);
    expect([...walkInRow.metadata.changedFields].sort()).toEqual(
      ['patientId', 'providerId', 'treatmentTypeId'].sort(),
    );
  });

  it('always returns message as an array of strings for 400, 403, and 409 responses', async () => {
    const badRequest = await owner(http.post('/appointments')).send({}).expect(400);
    expect(Array.isArray(badRequest.body.message)).toBe(true);
    expect(badRequest.body.message.length).toBeGreaterThan(0);
    for (const item of badRequest.body.message) expect(typeof item).toBe('string');

    const forbidden = await http
      .post('/appointments')
      .set('Cookie', ownerCookie)
      .send(appointmentBody())
      .expect(403);
    expect(Array.isArray(forbidden.body.message)).toBe(true);

    await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    const conflict = await owner(http.post('/appointments'))
      .send(appointmentBody({ startsAt: localTime('2026-01-05', '10:05') }))
      .expect(409);
    expect(Array.isArray(conflict.body.message)).toBe(true);
  });

  it('rejects every slot rule with a clear conflict and at most three alternatives', async () => {
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '08:00') })),
      'working-hours',
    );
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '12:15') })),
      'working-hours',
    );
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '11:45') })),
      'working-hours',
    );

    await testDataSource.query(
      `INSERT INTO blocked_periods (provider_id, during, created_by)
       VALUES ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4)`,
      [providerId, localTime('2026-01-05', '10:15'), localTime('2026-01-05', '10:45'), ownerId],
    );
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '10:30') })),
      'blocked period',
    );
    await testDataSource.query('DELETE FROM blocked_periods');

    await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '10:15') })),
      'appointment',
    );
    await testDataSource.query('DELETE FROM appointments');
    await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '09:35') })),
      'appointment',
    );
    await testDataSource.query('DELETE FROM appointments');

    await expectConflict(
      owner(http.post('/appointments')).send(
        appointmentBody({
          startsAt: localTime('2026-01-05', '15:30'),
          durationMinutes: 90,
          durationOverrideReason: 'Long procedure',
        }),
      ),
      'working-hours',
    );
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2025-12-31', '12:00') })),
      'past',
    );

    await testDataSource.query('UPDATE patients SET archived_at = now() WHERE id = $1', [patientId]);
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody()),
      'archived',
    );
    await testDataSource.query('UPDATE patients SET archived_at = NULL WHERE id = $1', [patientId]);

    await testDataSource.query('UPDATE treatment_types SET is_active = false WHERE id = $1', [treatmentTypeId]);
    await expectConflict(owner(http.post('/appointments')).send(appointmentBody()), 'Treatment type');
    await testDataSource.query('UPDATE treatment_types SET is_active = true WHERE id = $1', [treatmentTypeId]);

    await testDataSource.query('UPDATE providers SET is_active = false WHERE id = $1', [providerId]);
    await expectConflict(owner(http.post('/appointments')).send(appointmentBody()), 'Provider');
    await testDataSource.query('UPDATE providers SET is_active = true WHERE id = $1', [providerId]);

    await testDataSource.query('DELETE FROM clinic_settings');
    await expectConflict(owner(http.post('/appointments')).send(appointmentBody()), 'Clinic settings');
  });

  it('returns three alternatives spread at least 60 minutes apart that are all independently bookable', async () => {
    await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    const response = await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '09:10') })),
      'appointment',
    );
    const alternatives = response.body.alternatives;
    expect(alternatives.length).toBe(3);
    for (let index = 1; index < alternatives.length; index += 1) {
      const gap = DateTime.fromISO(alternatives[index].startsAt).diff(
        DateTime.fromISO(alternatives[index - 1].startsAt),
        'minutes',
      ).minutes;
      expect(gap).toBeGreaterThanOrEqual(60);
    }
    for (const slot of alternatives) {
      const booked = await createAppointment({ startsAt: slot.startsAt });
      expect(booked.status).toBe(201);
      await testDataSource.query('DELETE FROM appointments');
    }
  });

  it('allows exact end-buffer and previous blocked-until boundaries', async () => {
    const previous = await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    await createAppointment({ startsAt: previous.body.blockedUntil });
    await createAppointment({ startsAt: localTime('2026-01-05', '16:20') });
  });

  it('allows cancelled and no-show appointments to free their slots', async () => {
    const cancelled = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    await owner(http.post(`/appointments/${cancelled.body.id}/status`))
      .send({ status: AppointmentStatus.Cancelled, reason: 'Patient called' })
      .expect(201);
    await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });

    const noShow = await createAppointment({ startsAt: localTime('2026-01-05', '11:00') });
    setNow('2026-01-05T09:01:00Z');
    await owner(http.post(`/appointments/${noShow.body.id}/status`))
      .send({ status: AppointmentStatus.NoShow })
      .expect(201);
    await createAppointment({ startsAt: localTime('2026-01-05', '11:00') });
  });

  it('serializes concurrent identical bookings and concurrent moves to the same slot', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const patient = await createPatient(`Concurrent ${attempt}`);
      const body = appointmentBody({ patientId: patient, startsAt: localTime('2026-01-05', '10:00') });
      const results = await Promise.all([
        settle(owner(http.post('/appointments')).send(body)),
        settle(owner(http.post('/appointments')).send(body)),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      await testDataSource.query('DELETE FROM appointments');
    }

    const first = await createAppointment({ startsAt: localTime('2026-01-05', '09:00') });
    const second = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    const results = await Promise.all([
      settle(owner(http.patch(`/appointments/${first.body.id}`)).send({ startsAt: localTime('2026-01-05', '14:00') })),
      settle(owner(http.patch(`/appointments/${second.body.id}`)).send({ startsAt: localTime('2026-01-05', '14:00') })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('reschedules atomically, excludes itself, and rejects terminal appointments', async () => {
    const appointment = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    await owner(http.patch(`/appointments/${appointment.body.id}`))
      .send({ startsAt: localTime('2026-01-05', '10:00') })
      .expect(200);
    await owner(http.patch(`/appointments/${appointment.body.id}`))
      .send({ startsAt: localTime('2026-01-05', '12:15') })
      .expect(409);
    const unchanged = await owner(http.get(`/appointments/${appointment.body.id}`)).expect(200);
    expect(unchanged.body.startsAt).toBe(appointment.body.startsAt);
    await owner(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Cancelled })
      .expect(201);
    await owner(http.patch(`/appointments/${appointment.body.id}`))
      .send({ startsAt: localTime('2026-01-05', '14:00') })
      .expect(409);
  });

  it('enforces every appointment status transition and owner-only completion transitions', async () => {
    const appointment = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    await owner(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Confirmed })
      .expect(201);
    setNow(localTime('2026-01-05', '09:00'));
    await receptionist(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Arrived })
      .expect(201);
    await receptionist(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.InProgress })
      .expect(403);
    await owner(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.InProgress })
      .expect(201);
    await receptionist(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Completed })
      .expect(403);
    await owner(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Completed })
      .expect(201);
    await owner(http.post(`/appointments/${appointment.body.id}/status`))
      .send({ status: AppointmentStatus.Arrived })
      .expect(409);

    const noShow = await createAppointment({ startsAt: localTime('2026-01-06', '10:00') });
    await owner(http.post(`/appointments/${noShow.body.id}/status`))
      .send({ status: AppointmentStatus.NoShow })
      .expect(409);
  });

  it('only allows arrival on the appointment clinic-local date, regardless of process timezone', async () => {
    const appointment = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    const statusUrl = `/appointments/${appointment.body.id}/status`;

    setNow(localTime('2026-01-04', '23:59'));
    await owner(http.post(statusUrl))
      .send({ status: AppointmentStatus.Arrived })
      .expect(409)
      .expect(({ body }) =>
        expect(body.message).toEqual(['A patient can only be marked as arrived on the day of the appointment']),
      );
    setNow(localTime('2026-01-06', '00:01'));
    await owner(http.post(statusUrl))
      .send({ status: AppointmentStatus.Arrived })
      .expect(409)
      .expect(({ body }) =>
        expect(body.message).toEqual(['A patient can only be marked as arrived on the day of the appointment']),
      );

    const originalTimezone = process.env.TZ;
    try {
      setNow(localTime('2026-01-05', '00:01'));
      process.env.TZ = 'Pacific/Kiritimati';
      await owner(http.post(statusUrl)).send({ status: AppointmentStatus.Arrived }).expect(201);
      await testDataSource.query('UPDATE appointments SET status = $2 WHERE id = $1', [
        appointment.body.id,
        AppointmentStatus.Scheduled,
      ]);
      setNow(localTime('2026-01-05', '23:59'));
      process.env.TZ = 'America/Los_Angeles';
      await owner(http.post(statusUrl)).send({ status: AppointmentStatus.Arrived }).expect(201);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('allows an arrived visit that crosses midnight to progress and complete the next day', async () => {
    const [appointment] = await testDataSource.query(
      `INSERT INTO appointments
       (patient_id, provider_id, treatment_type_id, starts_at, ends_at, blocked_until,
        status, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        patientId,
        providerId,
        treatmentTypeId,
        localTime('2026-01-05', '23:30'),
        localTime('2026-01-06', '00:30'),
        localTime('2026-01-06', '00:40'),
        AppointmentStatus.Arrived,
        AppointmentSource.Staff,
        ownerId,
      ],
    );
    setNow(localTime('2026-01-06', '00:05'));
    await owner(http.post(`/appointments/${appointment.id}/status`))
      .send({ status: AppointmentStatus.InProgress })
      .expect(201);
    setNow(localTime('2026-01-06', '00:35'));
    await owner(http.post(`/appointments/${appointment.id}/status`))
      .send({ status: AppointmentStatus.Completed })
      .expect(201);
  });

  it('requires valid duration overrides and snapshots the adjusted end and buffer times', async () => {
    await owner(http.post('/appointments'))
      .send(appointmentBody({ durationMinutes: 45 }))
      .expect(409)
      .expect(({ body }) => expect(body.message.join(' ')).toContain('reason'));
    await owner(http.post('/appointments'))
      .send(appointmentBody({ durationMinutes: 32, durationOverrideReason: 'Longer' }))
      .expect(409)
      .expect(({ body }) => expect(body.message.join(' ')).toContain('5-minute grid'));
    const appointment = await createAppointment({
      startsAt: localTime('2026-01-05', '10:00'),
      durationMinutes: 45,
      durationOverrideReason: 'Complex treatment',
    });
    expect(DateTime.fromISO(appointment.body.endsAt).diff(DateTime.fromISO(appointment.body.startsAt), 'minutes').minutes).toBe(45);
    expect(DateTime.fromISO(appointment.body.blockedUntil).diff(DateTime.fromISO(appointment.body.endsAt), 'minutes').minutes).toBe(10);
  });

  it('creates immediate walk-ins as arrived, explicit-time walk-ins as scheduled, and requires provider choice when ambiguous', async () => {
    setNow('2026-01-05T07:01:00Z');
    const immediate = await owner(http.post('/appointments/walk-in'))
      .send({ patientId, treatmentTypeId, providerId })
      .expect(201);
    expect(immediate.body.status).toBe(AppointmentStatus.Arrived);
    expect(immediate.body.source).toBe(AppointmentSource.WalkIn);

    const explicit = await owner(http.post('/appointments/walk-in'))
      .send({ patientId, treatmentTypeId, providerId, startsAt: localTime('2026-01-05', '13:00') })
      .expect(201);
    expect(explicit.body.status).toBe(AppointmentStatus.Scheduled);
    expect(explicit.body.source).toBe(AppointmentSource.WalkIn);

    const secondProviderId = await insertProvider(secondProviderUserId);
    await insertHours(secondProviderId);
    await owner(http.post('/appointments/walk-in'))
      .send({ patientId, treatmentTypeId })
      .expect(400);
  });

  it('returns alternatives for a blocked immediate walk-in', async () => {
    await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    setNow('2026-01-05T08:10:00Z');
    const response = await expectConflict(
      owner(http.post('/appointments/walk-in')).send({ patientId, treatmentTypeId, providerId }),
      'appointment',
    );
    expect(response.body.alternatives.length).toBeGreaterThan(0);
  });

  it('returns only validator-approved slots, and every returned slot can be booked', async () => {
    const result = await receptionist(
      http.get(`/scheduling/available-slots?providerId=${providerId}&treatmentTypeId=${treatmentTypeId}&date=2026-01-05`),
    ).expect(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    for (const slot of result.body.items) {
      const booked = await createAppointment({ startsAt: slot.startsAt });
      expect(booked.status).toBe(201);
      await testDataSource.query('DELETE FROM appointments');
    }
    await expectConflict(
      owner(http.post('/appointments')).send(appointmentBody({ startsAt: localTime('2026-01-05', '08:45') })),
      'working-hours',
    );

    const next = await receptionist(
      http.get(`/scheduling/next-available?providerId=${providerId}&treatmentTypeId=${treatmentTypeId}&from=${encodeURIComponent(localTime('2026-01-05', '09:00'))}&count=3`),
    ).expect(200);
    expect(next.body.items).toHaveLength(3);
    for (const slot of next.body.items) {
      await createAppointment({ startsAt: slot.startsAt });
      await testDataSource.query('DELETE FROM appointments');
    }
  });

  it('uses clinic-local hours independently of process timezone and handles spring-forward gaps', async () => {
    const originalTimezone = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      const first = await createAppointment({ startsAt: localTime('2026-01-05', '14:00') });
      process.env.TZ = 'America/Los_Angeles';
      const second = await createAppointment({ startsAt: localTime('2026-01-05', '15:00') });
      expect(DateTime.fromISO(first.body.startsAt).setZone('Africa/Maseru').toFormat('HH:mm')).toBe('14:00');
      expect(DateTime.fromISO(second.body.startsAt).setZone('Africa/Maseru').toFormat('HH:mm')).toBe('15:00');

      await testDataSource.query('DELETE FROM appointments');
      await testDataSource.query("UPDATE clinic_settings SET timezone = 'America/New_York' WHERE id = true");
      await testDataSource.query('DELETE FROM working_hours WHERE provider_id = $1', [providerId]);
      await insertHours(providerId, [
        { weekday: 0, start: '01:00', end: '04:00' },
      ]);
      setNow('2026-03-07T12:00:00Z');
      const slots = await owner(
        http.get(`/scheduling/available-slots?providerId=${providerId}&treatmentTypeId=${treatmentTypeId}&date=2026-03-08`),
      ).expect(200);
      expect(slots.body.items.length).toBeGreaterThan(0);
      expect(slots.body.items.some((slot: { startsAt: string }) =>
        DateTime.fromISO(slot.startsAt).setZone('America/New_York').hour === 2,
      )).toBe(false);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('writes one patient-linked audit row per action without notes, reasons, or patient names', async () => {
    const created = await createAppointment({
      startsAt: localTime('2026-01-05', '10:00'),
      notes: 'Private appointment note',
    });
    await owner(http.patch(`/appointments/${created.body.id}`))
      .send({ startsAt: localTime('2026-01-05', '11:00'), notes: 'Updated private note' })
      .expect(200);
    await owner(http.post(`/appointments/${created.body.id}/status`))
      .send({ status: AppointmentStatus.Cancelled, reason: 'Sensitive cancellation reason' })
      .expect(201);
    setNow('2026-01-05T07:01:00Z');
    const walkIn = await owner(http.post('/appointments/walk-in'))
      .send({ patientId, providerId, treatmentTypeId })
      .expect(201);
    expect(walkIn.body.status).toBe(AppointmentStatus.Arrived);

    const rows = await testDataSource.query(
      `SELECT action, patient_id AS "patientId", metadata::text AS metadata
       FROM audit_log WHERE action IN (
         'appointment.create', 'appointment.update', 'appointment.status_change', 'appointment.walk_in'
       ) ORDER BY id`,
    );
    expect(rows).toHaveLength(4);
    expect(rows.map((row: { action: string }) => row.action)).toEqual([
      'appointment.create',
      'appointment.update',
      'appointment.status_change',
      'appointment.walk_in',
    ]);
    for (const row of rows) {
      expect(row.patientId).toBe(patientId);
      expect(row.metadata).not.toContain('Private appointment note');
      expect(row.metadata).not.toContain('Sensitive cancellation reason');
      expect(row.metadata).not.toContain('Ada Lovelace');
    }
    expect(JSON.parse(rows[2].metadata)).toEqual({
      fromStatus: AppointmentStatus.Scheduled,
      toStatus: AppointmentStatus.Cancelled,
    });
  });

  it('filters calendar data, limits its range, and protects calendar reads and writes', async () => {
    const appointment = await createAppointment({ startsAt: localTime('2026-01-05', '10:00') });
    const from = encodeURIComponent(localTime('2026-01-05', '00:00'));
    const to = encodeURIComponent(localTime('2026-01-06', '00:00'));
    const all = await receptionist(
      http.get(`/appointments?from=${from}&to=${to}&providerId=${providerId}&status=scheduled`),
    ).expect(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0]).toMatchObject({
      id: appointment.body.id,
      patientId,
      patientName: 'Ada Lovelace',
      providerId,
      status: AppointmentStatus.Scheduled,
      source: AppointmentSource.Staff,
    });
    expect(all.body[0]).not.toHaveProperty('medicalHistory');

    await owner(
      http.get('/appointments?from=2026-01-01T00%3A00%3A00Z&to=2026-02-02T00%3A00%3A00Z'),
    ).expect(400);
    await http.get(`/appointments?from=${from}&to=${to}`).expect(401);
    await http
      .post('/appointments')
      .set('Cookie', ownerCookie)
      .send(appointmentBody({ startsAt: localTime('2026-01-05', '14:00') }))
      .expect(403);
  });
});
