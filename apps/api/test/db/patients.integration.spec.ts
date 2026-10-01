import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import '../../src/database/data-source';
import { EncryptionService } from '../../src/common/encryption.service';
import { validateEnvironment } from '../../src/config/env.validation';
import { databaseEntities } from '../../src/database/entities';
import { SeverityLevel, UserRole } from '../../src/database/enums';
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

const originalTimezone = process.env.TZ;
process.env.TZ = 'Pacific/Kiritimati';

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

const ownerPassword = 'patient suite owner password';
const receptionistPassword = 'patient suite receptionist password';
let app: INestApplication;
let http: supertest.Agent;
let ownerId: string;
let ownerEmail: string;
let receptionistEmail: string;
let ownerCookie: string;
let receptionistCookie: string;
let phoneCounter = 100;

function phone(): string {
  phoneCounter += 1;
  return `5812${String(phoneCounter).padStart(4, '0')}`;
}

function patientBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Alex',
    lastName: 'Molefe',
    dateOfBirth: '1990-04-12',
    phone: phone(),
    ...overrides,
  };
}

function cookieFrom(response: supertest.Response): string {
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('Login response did not set a cookie');
  return cookie.split(';')[0]!;
}

function asUser(cookie: string, request: supertest.Test): supertest.Test {
  return request.set('Cookie', cookie).set('X-Requested-With', 'smile-bridge');
}

async function insertUser(
  role: UserRole,
  password: string,
): Promise<{ id: string; email: string }> {
  const email = `${role}-${randomUUID()}@example.invalid`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Patient Test User', $3) RETURNING id`,
    [email, passwordHash, role],
  );
  return { id: user.id, email };
}

async function login(email: string, password: string): Promise<string> {
  const response = await http
    .post('/auth/login')
    .set('X-Requested-With', 'smile-bridge')
    .send({ email, password })
    .expect(201);
  return cookieFrom(response);
}

async function createPatient(overrides: Record<string, unknown> = {}) {
  return asUser(ownerCookie, http.post('/patients')).send(patientBody(overrides)).expect(201);
}

function percentile95(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
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
  ({ id: ownerId, email: ownerEmail } = await insertUser(UserRole.DentistOwner, ownerPassword));
  receptionistEmail = (await insertUser(UserRole.Receptionist, receptionistPassword)).email;
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
  await testDataSource.query('TRUNCATE patients CASCADE');
  await testDataSource.query('TRUNCATE sessions RESTART IDENTITY CASCADE');
  await testDataSource.query('TRUNCATE audit_log RESTART IDENTITY CASCADE');
  http = supertest(app.getHttpServer());
  ownerCookie = await login(ownerEmail, ownerPassword);
  receptionistCookie = await login(receptionistEmail, receptionistPassword);
});

afterAll(async () => {
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('patients module', () => {
  it('creates with local and international E.164 phones and rejects invalid or incomplete input', async () => {
    const local = await createPatient({ phone: '58123456' });
    const international = await createPatient({ firstName: 'Jordan', phone: '+26658123457' });
    expect(local.body.phone).toBe('+26658123456');
    expect(international.body.phone).toBe('+26658123457');
    await asUser(ownerCookie, http.post('/patients'))
      .send(patientBody({ phone: 'not a phone' }))
      .expect(400)
      .expect(({ body }) => expect(body.message).toContain('Invalid phone number'));
    await asUser(ownerCookie, http.post('/patients'))
      .send({ firstName: 'Only a name' })
      .expect(400);
    await asUser(ownerCookie, http.post('/patients'))
      .send(patientBody({ dateOfBirth: '2015-01-01' }))
      .expect(400)
      .expect(({ body }) => expect(body.message).toContain('Guardian name and phone'));
    await createPatient({
      dateOfBirth: '2015-01-01',
      guardianName: 'Parent Molefe',
      guardianPhone: '58123458',
    });
  });

  it('returns phone and name/date duplicate matches unless confirmNotDuplicate is set', async () => {
    const original = await createPatient({
      firstName: 'Lerato',
      lastName: 'Mokoena',
      dateOfBirth: '1985-08-09',
      phone: '58123501',
    });
    const byPhone = await asUser(ownerCookie, http.post('/patients'))
      .send(patientBody({ firstName: 'Different', phone: '+26658123501' }))
      .expect(409);
    expect(byPhone.body.matches).toEqual([
      expect.objectContaining({
        id: original.body.id,
        name: 'Lerato Mokoena',
        phone: '+26658123501',
      }),
    ]);
    const byName = await asUser(ownerCookie, http.post('/patients'))
      .send(
        patientBody({
          firstName: 'LERATO',
          lastName: 'mokoena',
          dateOfBirth: '1985-08-09',
          phone: '58123502',
        }),
      )
      .expect(409);
    expect(byName.body.matches[0].id).toBe(original.body.id);
    expect(byName.body.matches[0].dateOfBirth).toBe('1985-08-09');
    await asUser(ownerCookie, http.post('/patients'))
      .send(patientBody({ firstName: 'Different', phone: '58123501', confirmNotDuplicate: true }))
      .expect(201);
  });

  it('returns date-only DOB values consistently across timezones and patient endpoints', async () => {
    const readDateResponses = async (firstName: string) => {
      const created = await createPatient({
        firstName,
        lastName: 'Timezone',
        dateOfBirth: '1990-04-12',
      });
      const search = await http
        .get(`/patients?q=${encodeURIComponent(firstName)}`)
        .set('Cookie', ownerCookie)
        .expect(200);
      const profile = await http
        .get(`/patients/${created.body.id}`)
        .set('Cookie', ownerCookie)
        .expect(200);
      const duplicate = await asUser(ownerCookie, http.post('/patients'))
        .send(patientBody({
          firstName,
          lastName: 'Timezone',
          dateOfBirth: '1990-04-12',
          phone: phone(),
        }))
        .expect(409);
      return {
        create: created.body.dateOfBirth,
        search: search.body.items.find((item: { id: string }) => item.id === created.body.id)
          .dateOfBirth,
        profile: profile.body.dateOfBirth,
        duplicate: duplicate.body.matches[0].dateOfBirth,
      };
    };

    try {
      process.env.TZ = 'Pacific/Kiritimati';
      const kiritimatiResponses = await readDateResponses('Kiri');
      process.env.TZ = 'America/Los_Angeles';
      const losAngelesResponses = await readDateResponses('Angeles');
      expect(kiritimatiResponses).toEqual({
        create: '1990-04-12',
        search: '1990-04-12',
        profile: '1990-04-12',
        duplicate: '1990-04-12',
      });
      expect(losAngelesResponses).toEqual(kiritimatiResponses);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('requires a guardian until the patient turns 18, but not on their birthday', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const birthDateForBirthday = (birthday: string) => {
      const [year, month, day] = birthday.split('-');
      return `${Number(year) - 18}-${month}-${day}`;
    };

    const adultToday = await createPatient({
      firstName: 'Adult',
      dateOfBirth: birthDateForBirthday(today),
    });
    expect(adultToday.status).toBe(201);

    await asUser(ownerCookie, http.post('/patients'))
      .send(patientBody({
        firstName: 'Minor',
        dateOfBirth: birthDateForBirthday(tomorrow),
      }))
      .expect(400)
      .expect(({ body }) => expect(body.message).toContain('Guardian name and phone'));
    await createPatient({
      firstName: 'Minor',
      dateOfBirth: birthDateForBirthday(tomorrow),
      guardianName: 'Parent Molefe',
      guardianPhone: '58123459',
    });
  });

  it('searches partial and misspelt names, phone, and number while excluding archived records', async () => {
    const match = await createPatient({
      firstName: 'Jonathan',
      lastName: 'Smith',
      phone: '58123511',
    });
    const partial = await http.get('/patients?q=Jonat').set('Cookie', ownerCookie).expect(200);
    expect(partial.body.items.some((item: { id: string }) => item.id === match.body.id)).toBe(true);
    const typo = await http
      .get('/patients?q=Jonathn%20Smit')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(typo.body.items.some((item: { id: string }) => item.id === match.body.id)).toBe(true);
    const byPhone = await http
      .get('/patients?q=26658123511')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(byPhone.body.items.some((item: { id: string }) => item.id === match.body.id)).toBe(true);
    const byNumber = await http
      .get(`/patients?q=${match.body.patientNumber}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(byNumber.body.items[0].id).toBe(match.body.id);
    await asUser(ownerCookie, http.post(`/patients/${match.body.id}/archive`)).expect(201);
    const excluded = await http.get('/patients?q=Jonathan').set('Cookie', ownerCookie).expect(200);
    expect(excluded.body.items.some((item: { id: string }) => item.id === match.body.id)).toBe(
      false,
    );
    const included = await http
      .get('/patients?q=Jonathan&includeArchived=true')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(included.body.items.some((item: { id: string }) => item.id === match.body.id)).toBe(
      true,
    );
    await http.get('/patients?pageSize=51').set('Cookie', ownerCookie).expect(400);
  });

  it('matches every name word by substring or word similarity without unrelated results', async () => {
    const palesa = await createPatient({ firstName: 'Palesa', lastName: 'Mokoena' });
    const thabo = await createPatient({
      firstName: 'Thabo',
      lastName: 'Molapo',
      dateOfBirth: '1988-06-21',
    });

    const search = async (q: string) =>
      http.get(`/patients?q=${encodeURIComponent(q)}`).set('Cookie', ownerCookie).expect(200);
    for (const query of ['mokone', 'palesa mokone', 'mokoena palesa', 'moko']) {
      const response = await search(query);
      expect(response.body.items.some((item: { id: string }) => item.id === palesa.body.id)).toBe(
        true,
      );
    }
    const typo = await search('mokone');
    expect(typo.body.items.some((item: { id: string }) => item.id === thabo.body.id)).toBe(false);
    const unrelated = await search('xyzq');
    expect(unrelated.body.total).toBe(0);
    expect(unrelated.body.items).toEqual([]);
  });

  it('meets the 300 ms p95 name and phone search target with 50,000 inline rows', async () => {
    await testDataSource.query(
      `INSERT INTO patients (first_name, last_name, date_of_birth, phone_e164, created_by)
       SELECT 'Z' || md5('Perf' || n::text), 'PerfSurname', DATE '1980-01-01',
              '+26658' || lpad(n::text, 6, '0'), $1
       FROM generate_series(1, 50000) AS n`,
      [ownerId],
    );
    try {
      await testDataSource.query('ANALYZE patients');
      const queryPlan = await testDataSource.transaction(async (manager) => {
        await manager.query('SET LOCAL pg_trgm.word_similarity_threshold = 0.5');
        return manager.query(
          `EXPLAIN SELECT id FROM patients
           WHERE archived_at IS NULL
             AND (lower(first_name || ' ' || last_name) LIKE '%mokone%'
                  OR 'mokone' <% lower(first_name || ' ' || last_name))`,
        );
      });
      expect(queryPlan.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']).join('\n')).toContain(
        'patients_name_trgm',
      );
      const nameTimes: number[] = [];
      const phoneTimes: number[] = [];
      const targetName = `Z${createHash('md5').update('Perf49999').digest('hex')}`;
      for (let run = 1; run <= 10; run += 1) {
        let started = performance.now();
        await http.get(`/patients?q=${targetName}`).set('Cookie', ownerCookie).expect(200);
        nameTimes.push(performance.now() - started);
        started = performance.now();
        await http.get('/patients?q=26658049999').set('Cookie', ownerCookie).expect(200);
        phoneTimes.push(performance.now() - started);
      }
      expect(percentile95(nameTimes)).toBeLessThan(300);
      expect(percentile95(phoneTimes)).toBeLessThan(300);
    } finally {
      await testDataSource.query('TRUNCATE patients CASCADE');
    }
  }, 300000);

  it('computes profile completeness from address, next of kin, and confirmed history only', async () => {
    const patient = await createPatient();
    let profile = await http
      .get(`/patients/${patient.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(profile.body.profileStatus).toEqual({
      complete: false,
      missing: ['address', 'nextOfKin', 'medicalHistory'],
    });
    expect(profile.body).not.toHaveProperty('conditions');
    await asUser(ownerCookie, http.patch(`/patients/${patient.body.id}`))
      .send({ address: '12 Kingsway, Maseru' })
      .expect(200);
    await asUser(ownerCookie, http.post(`/patients/${patient.body.id}/next-of-kin`))
      .send({ fullName: 'Parent Molefe', relationship: 'parent', phone: '58123522' })
      .expect(201);
    await asUser(receptionistCookie, http.put(`/patients/${patient.body.id}/medical-history`))
      .send({ conditions: 'history awaiting confirmation' })
      .expect(200);
    profile = await http.get(`/patients/${patient.body.id}`).set('Cookie', ownerCookie).expect(200);
    expect(profile.body.profileStatus.missing).toEqual(['medicalHistory']);
    expect(profile.body).not.toHaveProperty('conditions');
    await asUser(
      ownerCookie,
      http.post(`/patients/${patient.body.id}/medical-history/confirm`),
    ).expect(201);
    profile = await http.get(`/patients/${patient.body.id}`).set('Cookie', ownerCookie).expect(200);
    expect(profile.body.profileStatus).toEqual({ complete: true, missing: [] });
    await asUser(receptionistCookie, http.put(`/patients/${patient.body.id}/medical-history`))
      .send({ notes: 'later intake edit' })
      .expect(200);
    profile = await http.get(`/patients/${patient.body.id}`).set('Cookie', ownerCookie).expect(200);
    expect(profile.body.profileStatus.missing).toEqual(['medicalHistory']);
  });

  it('allows both roles to read and edit history, but only an owner can confirm', async () => {
    const patient = await createPatient();
    await asUser(receptionistCookie, http.put(`/patients/${patient.body.id}/medical-history`))
      .send({ medications: 'medicine list' })
      .expect(200);
    await asUser(
      receptionistCookie,
      http.post(`/patients/${patient.body.id}/medical-history/confirm`),
    ).expect(403);
    await asUser(
      ownerCookie,
      http.post(`/patients/${patient.body.id}/medical-history/confirm`),
    ).expect(201);
    const history = await http
      .get(`/patients/${patient.body.id}/medical-history`)
      .set('Cookie', receptionistCookie)
      .expect(200);
    expect(history.body.medications).toBe('medicine list');
  });

  it('encrypts medical fields, round-trips them, detects tampering, and rejects invalid keys at startup', async () => {
    const patient = await createPatient();
    const plaintext = 'private medical conditions value';
    await asUser(ownerCookie, http.put(`/patients/${patient.body.id}/medical-history`))
      .send({ conditions: plaintext, medications: 'private medication', notes: 'private notes' })
      .expect(200);
    const [stored] = await testDataSource.query(
      'SELECT conditions, medications, notes FROM medical_histories WHERE patient_id=$1',
      [patient.body.id],
    );
    expect(Buffer.isBuffer(stored.conditions)).toBe(true);
    expect(stored.conditions.includes(Buffer.from(plaintext))).toBe(false);
    expect(app.get(EncryptionService).decrypt(stored.conditions)).toBe(plaintext);
    const tampered = Buffer.from(stored.conditions);
    tampered[15] = tampered[15]! ^ 0xff;
    expect(() => app.get(EncryptionService).decrypt(tampered)).toThrow();
    expect(() => validateEnvironment({ ...process.env, ENCRYPTION_KEY: '' })).toThrow();
    expect(() =>
      validateEnvironment({ ...process.env, ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }),
    ).toThrow();
  });

  it('rejects archived edits and allows them again after restore', async () => {
    const patient = await createPatient();
    await asUser(ownerCookie, http.post(`/patients/${patient.body.id}/archive`)).expect(201);
    await asUser(ownerCookie, http.patch(`/patients/${patient.body.id}`))
      .send({ address: 'not allowed' })
      .expect(409);
    await asUser(ownerCookie, http.post(`/patients/${patient.body.id}/restore`)).expect(201);
    await asUser(ownerCookie, http.patch(`/patients/${patient.body.id}`))
      .send({ address: 'allowed now' })
      .expect(200);
  });

  it('writes one patient-scoped audit row per action without recording submitted values', async () => {
    const patient = await createPatient({
      firstName: 'AuditPatientName',
      phone: '58123601',
      email: 'private.patient@example.invalid',
    });
    const id = patient.body.id as string;
    await asUser(ownerCookie, http.patch(`/patients/${id}`))
      .send({ address: 'private address value' })
      .expect(200);
    await http.get(`/patients/${id}`).set('Cookie', ownerCookie).expect(200);
    const kin = await asUser(ownerCookie, http.post(`/patients/${id}/next-of-kin`))
      .send({ fullName: 'Private Kin Value', relationship: 'parent', phone: '58123602' })
      .expect(201);
    await asUser(ownerCookie, http.patch(`/patients/${id}/next-of-kin/${kin.body.id}`))
      .send({ relationship: 'guardian' })
      .expect(200);
    await asUser(ownerCookie, http.delete(`/patients/${id}/next-of-kin/${kin.body.id}`)).expect(
      200,
    );
    const allergy = await asUser(ownerCookie, http.post(`/patients/${id}/allergies`))
      .send({
        substance: 'PrivateAllergyValue',
        reaction: 'PrivateReactionValue',
        severity: SeverityLevel.Mild,
      })
      .expect(201);
    await asUser(ownerCookie, http.patch(`/patients/${id}/allergies/${allergy.body.id}`))
      .send({ resolved: true })
      .expect(200);
    const policy = await asUser(ownerCookie, http.post(`/patients/${id}/insurance`))
      .send({
        insurerName: 'PrivateInsurer',
        policyNumber: 'PrivatePolicyValue',
        principalMemberName: 'PrivateMember',
      })
      .expect(201);
    await asUser(ownerCookie, http.patch(`/patients/${id}/insurance/${policy.body.id}`))
      .send({ isActive: false })
      .expect(200);
    await http.get(`/patients/${id}/medical-history`).set('Cookie', ownerCookie).expect(200);
    const historyValue = 'PrivateMedicalHistoryValue';
    await asUser(ownerCookie, http.put(`/patients/${id}/medical-history`))
      .send({
        conditions: historyValue,
        medications: 'PrivateMedicationValue',
        notes: 'PrivateNotesValue',
      })
      .expect(200);
    await asUser(ownerCookie, http.post(`/patients/${id}/medical-history/confirm`)).expect(201);
    await http.get(`/patients/${id}/medical-history`).set('Cookie', ownerCookie).expect(200);
    await asUser(ownerCookie, http.put(`/patients/${id}/medical-history`))
      .send({ notes: 'PrivateLaterEditValue' })
      .expect(200);
    await asUser(ownerCookie, http.post(`/patients/${id}/archive`)).expect(201);
    await asUser(ownerCookie, http.post(`/patients/${id}/restore`)).expect(201);

    const expected: Array<[string, number]> = [
      ['patient.create', 1],
      ['patient.update', 1],
      ['patient.view', 1],
      ['patient.archive', 1],
      ['patient.restore', 1],
      ['patient.create_next_of_kin', 1],
      ['patient.update_next_of_kin', 1],
      ['patient.delete_next_of_kin', 1],
      ['patient.create_allergy', 1],
      ['patient.update_allergy', 1],
      ['patient.create_insurance', 1],
      ['patient.update_insurance', 1],
      ['patient.view_medical_history', 2],
      ['patient.update_medical_history', 2],
      ['patient.confirm_medical_history', 1],
    ];
    for (const [action, count] of expected) {
      const [row] = await testDataSource.query(
        'SELECT count(*)::int AS count FROM audit_log WHERE action=$1 AND patient_id=$2',
        [action, id],
      );
      expect(row.count).toBe(count);
    }
    const rows = await testDataSource.query(
      'SELECT to_jsonb(audit_log)::text AS data, metadata FROM audit_log WHERE patient_id=$1',
      [id],
    );
    const forbidden = [
      'private.patient@example.invalid',
      '+26658123601',
      '+26658123602',
      'private address value',
      'Private Kin Value',
      'PrivateAllergyValue',
      'PrivateReactionValue',
      'PrivatePolicyValue',
      'PrivateMember',
      historyValue,
      'PrivateMedicationValue',
      'PrivateNotesValue',
      'PrivateLaterEditValue',
    ];
    for (const row of rows) {
      for (const value of forbidden) expect(row.data).not.toContain(value);
    }
    const [updateAudit] = await testDataSource.query(
      "SELECT metadata FROM audit_log WHERE patient_id=$1 AND action='patient.update'",
      [id],
    );
    expect(updateAudit.metadata).toEqual({ changedFields: ['address'] });
  });

  it('requires authentication and the CSRF header for state-changing routes', async () => {
    await http.get('/patients').expect(401);
    await http.post('/patients').send(patientBody()).expect(401);
    await http.post('/patients').set('Cookie', ownerCookie).send(patientBody()).expect(403);
  });
});
