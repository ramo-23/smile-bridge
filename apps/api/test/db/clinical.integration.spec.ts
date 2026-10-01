import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import '../../src/database/data-source';
import { EncryptionService } from '../../src/common/encryption.service';
import { databaseEntities } from '../../src/database/entities';
import { AppointmentSource, AppointmentStatus, PlanStatus, ToothRecordType, ToothSurface, UserRole } from '../../src/database/enums';
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
import { AuditService } from '../../src/modules/audit/audit.service';

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

const password = 'clinical integration password';
let app: INestApplication;
let http: supertest.Agent;
let ownerId: string;
let receptionistId: string;
let ownerEmail: string;
let receptionistEmail: string;
let ownerCookie: string;
let receptionistCookie: string;
let patientId: string;
let otherPatientId: string;
let treatmentTypeId: string;
let otherTreatmentTypeId: string;
let appointmentId: string;
let foreignAppointmentId: string;
let counter = 0;

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

async function createUser(role: UserRole) {
  const email = `${role}-${randomUUID()}@example.invalid`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Clinical Test User', $3) RETURNING id`,
    [email, hash, role],
  );
  return { id: user.id as string, email };
}

async function login(email: string) {
  const response = await http
    .post('/auth/login')
    .set('X-Requested-With', 'smile-bridge')
    .send({ email, password })
    .expect(201);
  return cookieFrom(response);
}

async function createPatient(name: string) {
  counter += 1;
  const [patient] = await testDataSource.query(
    `INSERT INTO patients (first_name, last_name, date_of_birth, phone_e164, created_by)
     VALUES ($1, $2, '1990-04-12', $3, $4) RETURNING id`,
    [name.split(' ')[0], name.split(' ').slice(1).join(' '), `+2665812${String(counter).padStart(4, '0')}`, ownerId],
  );
  return patient.id as string;
}

async function createAppointment(targetPatientId = patientId, offsetHours = 1) {
  const startsAt = new Date(Date.now() + offsetHours * 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + (offsetHours + 1) * 3_600_000).toISOString();
  const blockedUntil = new Date(Date.now() + (offsetHours + 1.17) * 3_600_000).toISOString();
  const [appointment] = await testDataSource.query(
    `INSERT INTO appointments
     (patient_id, provider_id, treatment_type_id, starts_at, ends_at, blocked_until, status, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [targetPatientId, providerId, treatmentTypeId, startsAt, endsAt, blockedUntil, AppointmentStatus.Scheduled, AppointmentSource.Staff, ownerId],
  );
  return appointment.id as string;
}

let providerId: string;

async function createToothRecord(overrides: Record<string, unknown> = {}) {
  return owner(http.post(`/patients/${patientId}/tooth-records`))
    .send({
      toothNumber: 14,
      surface: ToothSurface.Occlusal,
      recordType: ToothRecordType.Finding,
      conditionCode: 'caries',
      ...overrides,
    })
    .expect(201);
}

async function createNote(body = 'Clinical note one', targetPatientId = patientId) {
  return owner(http.post(`/patients/${targetPatientId}/clinical-notes`)).send({ body }).expect(201);
}

async function createPlan(items: Array<Record<string, unknown>>) {
  return owner(http.post(`/patients/${patientId}/treatment-plans`)).send({ items }).expect(201);
}

async function createPlanItem(planId: string, overrides: Record<string, unknown> = {}) {
  return owner(http.post(`/treatment-plans/${planId}/items`))
    .send({ items: [{ treatmentTypeId, ...overrides }] })
    .expect(201);
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

  const ownerUser = await createUser(UserRole.DentistOwner);
  const receptionistUser = await createUser(UserRole.Receptionist);
  ownerId = ownerUser.id;
  receptionistId = receptionistUser.id;
  ownerEmail = ownerUser.email;
  receptionistEmail = receptionistUser.email;

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
    `TRUNCATE tooth_records, clinical_note_versions, clinical_notes, treatment_plan_items,
     treatment_plans, appointments, providers, treatment_types, patients, sessions, audit_log
     RESTART IDENTITY CASCADE`,
  );
  patientId = await createPatient('Avery Sentinel');
  otherPatientId = await createPatient('Morgan Other');
  const [provider] = await testDataSource.query(
    'INSERT INTO providers (user_id, display_name) VALUES ($1, $2) RETURNING id',
    [ownerId, 'Clinical Provider'],
  );
  providerId = provider.id as string;
  const [treatment] = await testDataSource.query(
    `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents, is_active)
     VALUES ('Clinical Exam', 30, 12500, true) RETURNING id`,
  );
  treatmentTypeId = treatment.id as string;
  const [otherTreatment] = await testDataSource.query(
    `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents, is_active)
     VALUES ('Inactive Plan Service', 45, 22000, true) RETURNING id`,
  );
  otherTreatmentTypeId = otherTreatment.id as string;
  appointmentId = await createAppointment(patientId);
  foreignAppointmentId = await createAppointment(otherPatientId, 4);
  http = supertest(app.getHttpServer());
  ownerCookie = await login(ownerEmail);
  receptionistCookie = await login(receptionistEmail);
});

afterAll(async () => {
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('clinical records', () => {
  it('returns a complete current odontogram, replaces surface state, restores after void, and deactivates extracted surfaces', async () => {
    const fresh = await receptionist(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    expect(fresh.body.teeth).toHaveLength(32);
    expect(fresh.body.teeth[13]).toMatchObject({ toothNumber: 14, wholeTooth: null });
    expect(fresh.body.teeth[13].surfaces.occlusal).toBeNull();

    const filling = await createToothRecord({ conditionCode: 'filling', note: 'ODONTO_SENTINEL_NOTE' });
    let chart = await owner(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    expect(chart.body.teeth[13].surfaces.occlusal.conditionCode).toBe('filling');
    expect(JSON.stringify(chart.body)).not.toContain('ODONTO_SENTINEL_NOTE');
    const caries = await createToothRecord({ conditionCode: 'caries', note: 'LATER_CARIES_NOTE' });
    chart = await owner(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    expect(chart.body.teeth[13].surfaces.occlusal.conditionCode).toBe('caries');

    await owner(http.post(`/tooth-records/${caries.body.id}/void`))
      .send({ reason: 'ODONTO_VOID_REASON' })
      .expect(201);
    chart = await owner(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    expect(chart.body.teeth[13].surfaces.occlusal.conditionCode).toBe('filling');

    await createToothRecord({ toothNumber: 15, conditionCode: 'filling', note: 'Inactive surface' });
    await createToothRecord({ toothNumber: 15, surface: null, conditionCode: 'extracted' });
    chart = await owner(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    expect(chart.body.teeth[14].wholeTooth.conditionCode).toBe('extracted');
    expect(chart.body.teeth[14].surfacesInactive).toBe(true);
    expect(chart.body.teeth[14].surfaces.occlusal.inactive).toBe(true);
  });

  it('rejects invalid tooth numbers, codes, surfaces, and appointments belonging to another patient', async () => {
    for (const toothNumber of [0, 33]) {
      await owner(http.post(`/patients/${patientId}/tooth-records`))
        .send({ toothNumber, recordType: 'finding', conditionCode: 'caries' })
        .expect(400);
    }
    await owner(http.post(`/patients/${patientId}/tooth-records`))
      .send({ toothNumber: 14, surface: 'occlusal', recordType: 'finding', conditionCode: 'extracted' })
      .expect(400);
    await owner(http.post(`/patients/${patientId}/tooth-records`))
      .send({ toothNumber: 14, recordType: 'finding', conditionCode: 'invented_code' })
      .expect(400);
    await owner(http.post(`/patients/${patientId}/tooth-records`))
      .send({
        toothNumber: 14,
        surface: 'occlusal',
        recordType: 'finding',
        conditionCode: 'caries',
        appointmentId: foreignAppointmentId,
      })
      .expect(400);
  });

  it('voids append-only records without changing their clinical fields and includes void history', async () => {
    const created = await createToothRecord({ note: 'APPEND_ONLY_NOTE' });
    const [before] = await testDataSource.query(
      `SELECT tooth_number, surface, record_type, condition_code, note, appointment_id, recorded_by, recorded_at
       FROM tooth_records WHERE id = $1`,
      [created.body.id],
    );
    await owner(http.post(`/tooth-records/${created.body.id}/void`))
      .send({ reason: 'APPEND_ONLY_VOID_REASON' })
      .expect(201);
    await owner(http.post(`/tooth-records/${created.body.id}/void`))
      .send({ reason: 'Second void' })
      .expect(409);
    const [after] = await testDataSource.query(
      `SELECT tooth_number, surface, record_type, condition_code, note, appointment_id, recorded_by, recorded_at,
              voided_at, void_reason
       FROM tooth_records WHERE id = $1`,
      [created.body.id],
    );
    expect(after.tooth_number).toBe(before.tooth_number);
    expect(after.surface).toBe(before.surface);
    expect(after.record_type).toBe(before.record_type);
    expect(after.condition_code).toBe(before.condition_code);
    expect(after.note).toEqual(before.note);
    expect(after.appointment_id).toBe(before.appointment_id);
    expect(after.recorded_by).toBe(before.recorded_by);
    expect(after.recorded_at).toEqual(before.recorded_at);
    expect(after.voided_at).toBeTruthy();
    expect(after.void_reason).toBe('APPEND_ONLY_VOID_REASON');

    const history = await owner(http.get(`/patients/${patientId}/teeth/14/history`)).expect(200);
    expect(history.body[0]).toMatchObject({
      id: created.body.id,
      note: 'APPEND_ONLY_NOTE',
      voidReason: 'APPEND_ONLY_VOID_REASON',
    });
  });

  it('keeps encrypted clinical-note versions, decrypts reads, and serializes concurrent edits', async () => {
    const note = await createNote('NOTE_VERSION_ONE_SENTINEL');
    await owner(http.put(`/clinical-notes/${note.body.id}`))
      .send({ body: 'NOTE_VERSION_TWO_SENTINEL' })
      .expect(200);
    const versions = await owner(http.get(`/clinical-notes/${note.body.id}/versions`)).expect(200);
    expect(versions.body.map((version: { versionNo: number; body: string }) => [version.versionNo, version.body])).toEqual([
      [1, 'NOTE_VERSION_ONE_SENTINEL'],
      [2, 'NOTE_VERSION_TWO_SENTINEL'],
    ]);
    const list = await owner(http.get(`/patients/${patientId}/clinical-notes`)).expect(200);
    expect(list.body[0]).toMatchObject({
      id: note.body.id,
      body: 'NOTE_VERSION_TWO_SENTINEL',
      versionCount: 2,
    });

    const [stored] = await testDataSource.query(
      'SELECT body FROM clinical_note_versions WHERE note_id = $1 ORDER BY version_no LIMIT 1',
      [note.body.id],
    );
    expect(Buffer.isBuffer(stored.body)).toBe(true);
    expect(stored.body.toString('utf8')).not.toContain('NOTE_VERSION_ONE_SENTINEL');

    for (let repeat = 0; repeat < 5; repeat += 1) {
      const concurrentNote = await createNote(`CONCURRENT_BASE_${repeat}`);
      const responses = await Promise.all([
        http
          .put(`/clinical-notes/${concurrentNote.body.id}`)
          .set('Cookie', ownerCookie)
          .set('X-Requested-With', 'smile-bridge')
          .send({ body: `CONCURRENT_EDIT_A_${repeat}` }),
        http
          .put(`/clinical-notes/${concurrentNote.body.id}`)
          .set('Cookie', ownerCookie)
          .set('X-Requested-With', 'smile-bridge')
          .send({ body: `CONCURRENT_EDIT_B_${repeat}` }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const concurrentVersions = await owner(
        http.get(`/clinical-notes/${concurrentNote.body.id}/versions`),
      ).expect(200);
      expect(concurrentVersions.body.map((version: { versionNo: number }) => version.versionNo)).toEqual([
        1,
        2,
        3,
      ]);
    }
  });

  it('rejects a clinical note linked to another patient appointment', async () => {
    await owner(http.post(`/patients/${patientId}/clinical-notes`))
      .send({ appointmentId: foreignAppointmentId, body: 'Foreign appointment note' })
      .expect(400);
  });

  it('copies active catalogue prices into encrypted plan items and enforces plan status rules', async () => {
    const created = await createPlan([
      { treatmentTypeId, toothNumber: 14, description: 'PLAN_DESCRIPTION_SENTINEL' },
      { treatmentTypeId, description: 'Declined item' },
      { treatmentTypeId, description: 'Open item' },
    ]);
    const [doneItem, declinedItem, openItem] = created.body.items;
    expect(doneItem.priceCents).toBe(12500);
    await testDataSource.query('UPDATE treatment_types SET default_price_cents = 30000 WHERE id = $1', [treatmentTypeId]);
    const addedItems = await owner(http.post(`/treatment-plans/${created.body.id}/items`))
      .send({ items: [{ treatmentTypeId }] })
      .expect(201);
    expect(addedItems.body[0].priceCents).toBe(30000);

    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${doneItem.id}/status`))
      .send({ status: PlanStatus.Done })
      .expect(409);
    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${doneItem.id}/status`))
      .send({ status: PlanStatus.Accepted })
      .expect(200);
    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${doneItem.id}`))
      .send({ priceCents: 999 })
      .expect(409);
    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${doneItem.id}/status`))
      .send({ status: PlanStatus.Done })
      .expect(200);

    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${declinedItem.id}/status`))
      .send({ status: PlanStatus.Declined })
      .expect(200);
    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${declinedItem.id}/status`))
      .send({ status: PlanStatus.Proposed })
      .expect(200);
    await owner(http.patch(`/treatment-plans/${created.body.id}/items/${declinedItem.id}/status`))
      .send({ status: PlanStatus.Declined })
      .expect(200);

    const [inactive] = await testDataSource.query(
      `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents, is_active)
       VALUES ('Inactive Plan Type', 30, 4000, false) RETURNING id`,
    );
    await owner(http.post(`/patients/${patientId}/treatment-plans`))
      .send({ items: [{ treatmentTypeId: inactive.id }] })
      .expect(400);

    const [encrypted] = await testDataSource.query(
      'SELECT description FROM treatment_plan_items WHERE id = $1',
      [doneItem.id],
    );
    expect(encrypted.description.toString('utf8')).not.toContain('PLAN_DESCRIPTION_SENTINEL');
    const plans = await owner(http.get(`/patients/${patientId}/treatment-plans`)).expect(200);
    const plan = plans.body.find((item: { id: string }) => item.id === created.body.id);
    expect(plan.items.find((item: { id: string }) => item.id === doneItem.id).description).toBe(
      'PLAN_DESCRIPTION_SENTINEL',
    );
    expect(plan.totalCents).toBe(55000);
    expect(plan.statusCounts).toMatchObject({
      [PlanStatus.Done]: 1,
      [PlanStatus.Declined]: 1,
      [PlanStatus.Proposed]: 2,
    });
    expect(plan.items.find((item: { id: string }) => item.id === openItem.id).status).toBe(PlanStatus.Proposed);
  });

  it('gives receptionists read-only access, rejects unauthenticated reads, and enforces CSRF on every write', async () => {
    const tooth = await createToothRecord();
    const note = await createNote();
    const plan = await createPlan([{ treatmentTypeId }]);
    const itemId = plan.body.items[0].id;
    const gets = [
      `/patients/${patientId}/odontogram`,
      `/patients/${patientId}/teeth/14/history`,
      `/patients/${patientId}/clinical-notes`,
      `/clinical-notes/${note.body.id}/versions`,
      `/patients/${patientId}/treatment-plans`,
    ];
    for (const path of gets) await receptionist(http.get(path)).expect(200);
    const readActions = [
      'clinical.odontogram.view',
      'clinical.tooth_history.view',
      'clinical.notes.view',
      'clinical.note_versions.view',
      'clinical.plans.view',
    ];
    const receptionistReadAudits = await testDataSource.query(
      `SELECT action, count(*)::int AS count FROM audit_log
       WHERE user_id = $1 AND action = ANY($2::text[]) GROUP BY action`,
      [receptionistId, readActions],
    );
    expect(receptionistReadAudits).toHaveLength(readActions.length);
    for (const row of receptionistReadAudits) expect(row.count).toBe(1);
    for (const path of gets) await http.get(path).expect(401);

    const writeFactories = [
      () => http.post(`/patients/${patientId}/tooth-records`).send({ toothNumber: 1, recordType: 'finding', conditionCode: 'caries' }),
      () => http.post(`/tooth-records/${tooth.body.id}/void`).send({ reason: 'Denied' }),
      () => http.post(`/patients/${patientId}/clinical-notes`).send({ body: 'Denied' }),
      () => http.put(`/clinical-notes/${note.body.id}`).send({ body: 'Denied' }),
      () => http.post(`/patients/${patientId}/treatment-plans`).send({ items: [{ treatmentTypeId }] }),
      () => http.post(`/treatment-plans/${plan.body.id}/items`).send({ items: [{ treatmentTypeId }] }),
      () => http.patch(`/treatment-plans/${plan.body.id}/items/${itemId}`).send({ priority: 3 }),
      () => http.patch(`/treatment-plans/${plan.body.id}/items/${itemId}/status`).send({ status: 'declined' }),
    ];
    const countsBefore = await testDataSource.query(
      `SELECT (SELECT count(*)::int FROM tooth_records) AS tooth_count,
              (SELECT count(*)::int FROM clinical_notes) AS note_count,
              (SELECT count(*)::int FROM treatment_plans) AS plan_count,
              (SELECT count(*)::int FROM treatment_plan_items) AS item_count`,
    );
    for (const makeRequest of writeFactories)
      await receptionist(makeRequest()).expect(403);
    for (const makeRequest of writeFactories)
      await makeRequest().set('Cookie', ownerCookie).expect(403);
    const countsAfter = await testDataSource.query(
      `SELECT (SELECT count(*)::int FROM tooth_records) AS tooth_count,
              (SELECT count(*)::int FROM clinical_notes) AS note_count,
              (SELECT count(*)::int FROM treatment_plans) AS plan_count,
              (SELECT count(*)::int FROM treatment_plan_items) AS item_count`,
    );
    expect(countsAfter).toEqual(countsBefore);
  });

  it('audits every clinical action exactly once with patient linkage and no sensitive values', async () => {
    const sentinel = [
      'AUDIT_TOOTH_NOTE_SENTINEL',
      'AUDIT_VOID_REASON_SENTINEL',
      'AUDIT_NOTE_BODY_SENTINEL',
      'AUDIT_NOTE_UPDATE_SENTINEL',
      'AUDIT_PLAN_DESCRIPTION_SENTINEL',
      'AUDIT_PLAN_REASON_SENTINEL',
      'AUDIT_CONDITION_SENTINEL',
    ];
    const tooth = await createToothRecord({ note: sentinel[0], conditionCode: 'filling' });
    await owner(http.post(`/tooth-records/${tooth.body.id}/void`)).send({ reason: sentinel[1] }).expect(201);
    await owner(http.get(`/patients/${patientId}/odontogram`)).expect(200);
    await owner(http.get(`/patients/${patientId}/teeth/14/history`)).expect(200);
    const note = await createNote(sentinel[2]);
    await owner(http.put(`/clinical-notes/${note.body.id}`)).send({ body: sentinel[3] }).expect(200);
    await owner(http.get(`/patients/${patientId}/clinical-notes`)).expect(200);
    await owner(http.get(`/clinical-notes/${note.body.id}/versions`)).expect(200);
    const plan = await createPlan([{ treatmentTypeId, description: sentinel[4] }]);
    const addedItems = await createPlanItem(plan.body.id, { description: sentinel[5] });
    const [item] = addedItems.body;
    await owner(http.patch(`/treatment-plans/${plan.body.id}/items/${item.id}`))
      .send({ priority: 3 })
      .expect(200);
    await owner(http.patch(`/treatment-plans/${plan.body.id}/items/${item.id}/status`))
      .send({ status: PlanStatus.Accepted })
      .expect(200);
    await owner(http.get(`/patients/${patientId}/treatment-plans`)).expect(200);

    const actions = [
      'clinical.tooth_record.create',
      'clinical.tooth_record.void',
      'clinical.odontogram.view',
      'clinical.tooth_history.view',
      'clinical.note.create',
      'clinical.note.update',
      'clinical.notes.view',
      'clinical.note_versions.view',
      'clinical.plan.create',
      'clinical.plan_item.add',
      'clinical.plan_item.update',
      'clinical.plan_item.status_change',
      'clinical.plans.view',
    ];
    const rows = await testDataSource.query(
      `SELECT action, patient_id AS "patientId", metadata, to_jsonb(audit_log)::text AS full_row
       FROM audit_log WHERE action LIKE 'clinical.%' ORDER BY id`,
    );
    expect(rows).toHaveLength(actions.length);
    expect(rows.map((row: { action: string }) => row.action)).toEqual(actions);
    for (const row of rows) {
      expect(row.patientId).toBe(patientId);
      for (const value of sentinel) expect(row.full_row).not.toContain(value);
      expect(row.metadata).not.toHaveProperty('toothNumber');
      expect(row.metadata).not.toHaveProperty('conditionCode');
      expect(row.metadata).not.toHaveProperty('reason');
    }

    const readerAudits = await testDataSource.query(
      `SELECT action, count(*)::int AS count FROM audit_log
       WHERE action IN ('clinical.odontogram.view', 'clinical.tooth_history.view',
         'clinical.notes.view', 'clinical.note_versions.view', 'clinical.plans.view')
       GROUP BY action`,
    );
    for (const row of readerAudits) expect(row.count).toBe(1);
  });

  it('rolls back a write and fails a read when the audit writer fails', async () => {
    const audit = app.get(AuditService);
    const writeSpy = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit failure'));
    await owner(http.post(`/patients/${patientId}/tooth-records`))
      .send({ toothNumber: 2, recordType: 'finding', conditionCode: 'caries' })
      .expect(500);
    writeSpy.mockRestore();
    const [toothCount] = await testDataSource.query('SELECT count(*)::int AS count FROM tooth_records');
    expect(toothCount.count).toBe(0);

    const readSpy = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit failure'));
    await owner(http.get(`/patients/${patientId}/odontogram`)).expect(500);
    readSpy.mockRestore();
    const [readCount] = await testDataSource.query(
      `SELECT count(*)::int AS count FROM audit_log WHERE action = 'clinical.odontogram.view'`,
    );
    expect(readCount.count).toBe(0);
  });
});
