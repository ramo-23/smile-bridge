import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource, QueryFailedError } from 'typeorm';
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
import { DocumentCounters1700000000014 } from '../../src/database/migrations/1700000000014-document-counters';
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
    DocumentCounters1700000000014,
  ],
  synchronize: false,
});


const password = 'billing integration password';
const PRICE_SENTINEL = 7654321;
const MANUAL_PRICE_SENTINEL = 4567891;
const NAME_SENTINEL = 'BILLING_NAME_SENTINEL';
const DESC_SENTINEL = 'BILLING_DESC_SENTINEL';
const CSRF = { 'X-Requested-With': 'smile-bridge' };

let app: INestApplication;
let http: supertest.Agent;
let ownerId: string;
let ownerEmail: string;
let receptionistEmail: string;
let ownerCookie: string;
let receptionistCookie: string;
let patientId: string;
let otherPatientId: string;
let treatmentTypeId: string;
let providerId: string;
let counter = 0;

function owner(request: supertest.Test): supertest.Test {
  return request.set('Cookie', ownerCookie).set(CSRF);
}

function receptionist(request: supertest.Test): supertest.Test {
  return request.set('Cookie', receptionistCookie).set(CSRF);
}

async function createUser(role: UserRole) {
  const email = `${role}-${randomUUID()}@example.invalid`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Billing Test User', $3) RETURNING id`,
    [email, hash, role],
  );
  return { id: user.id as string, email };
}

async function login(email: string) {
  const response = await http.post('/auth/login').set(CSRF).send({ email, password }).expect(201);
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('No session cookie');
  return cookie.split(';')[0]!;
}

async function createPatient(name: string) {
  counter += 1;
  const [patient] = await testDataSource.query(
    `INSERT INTO patients (first_name, last_name, date_of_birth, phone_e164, created_by)
     VALUES ($1, $2, '1990-04-12', $3, $4) RETURNING id`,
    [name.split(' ')[0], name.split(' ')[1], `+2665813${String(counter).padStart(4, '0')}`, ownerId],
  );
  return patient.id as string;
}

let slot = 0;

async function createAppointment(status: AppointmentStatus, targetPatientId = patientId, _unused?: number) {
  slot += 1;
  const offsetHours = 2 * slot;
  const startsAt = new Date(Date.now() + offsetHours * 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + (offsetHours + 1) * 3_600_000).toISOString();
  const blockedUntil = new Date(Date.now() + (offsetHours + 1.17) * 3_600_000).toISOString();
  const [appointment] = await testDataSource.query(
    `INSERT INTO appointments
     (patient_id, provider_id, treatment_type_id, starts_at, ends_at, blocked_until, status, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [targetPatientId, providerId, treatmentTypeId, startsAt, endsAt, blockedUntil, status, AppointmentSource.Staff, ownerId],
  );
  return appointment.id as string;
}

async function performTreatment(body: Record<string, unknown> = {}, targetPatientId = patientId) {
  const appointmentId = await createAppointment(AppointmentStatus.InProgress, targetPatientId, 1 + counter++);
  const response = await owner(http.post(`/appointments/${appointmentId}/performed-treatments`))
    .send({ treatmentTypeId, ...body })
    .expect(201);
  return response.body as { id: string; priceCents: number };
}

async function draftInvoice(ids?: string[], targetPatientId = patientId) {
  const response = await owner(http.post(`/patients/${targetPatientId}/invoices`))
    .send(ids ? { performedTreatmentIds: ids } : {})
    .expect(201);
  return response.body;
}

async function issuableInvoice(price = 1000) {
  const treatment = await performTreatment({ priceCents: price });
  return draftInvoice([treatment.id]);
}

async function issued(price = 1000) {
  const invoice = await issuableInvoice(price);
  const response = await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(201);
  return response.body as { id: string; invoiceNumber: string };
}

async function addPayment(invoiceId: string, amount: number) {
  await testDataSource.query(
    `INSERT INTO payments (invoice_id, method, amount_cents, received_by) VALUES ($1, 'cash', $2, $3)`,
    [invoiceId, amount, ownerId],
  );
}

async function addCredit(invoiceId: string, amount: number) {
  await testDataSource.query(
    `INSERT INTO credit_notes (credit_note_number, invoice_id, amount_cents, reason, created_by)
     VALUES ($1, $2, $3, 'test', $4)`,
    [`CN-${randomUUID()}`, invoiceId, amount, ownerId],
  );
}

async function auditRows(where = 'true') {
  return testDataSource.query(`SELECT * FROM audit_log WHERE ${where} ORDER BY occurred_at, id`);
}

async function counterValue() {
  const [row] = await testDataSource.query(`SELECT last_value::int AS v FROM document_counters WHERE name = 'invoice'`);
  return row.v as number;
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
  ownerEmail = ownerUser.email;
  receptionistEmail = receptionistUser.email;

  const { AppModule } = await import('../../src/app.module');
  const { NestFactory } = await import('@nestjs/core');
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  http = supertest(app.getHttpServer());
}, 120000);

beforeEach(async () => {
  jest.restoreAllMocks();
  await testDataSource.query(
    `TRUNCATE tooth_records, clinical_note_versions, clinical_notes, treatment_plan_items,
     treatment_plans, appointments, providers, treatment_types, patients, sessions, audit_log, clinic_settings
     RESTART IDENTITY CASCADE`,
  );
  await testDataSource.query(`UPDATE document_counters SET last_value = 0`);
  await testDataSource.query(
    `INSERT INTO clinic_settings (id, clinic_name, timezone, currency_code)
     VALUES (true, 'Test Clinic', 'Africa/Maseru', 'LSL')`,
  );
  patientId = await createPatient('Avery Sentinel');
  otherPatientId = await createPatient('Morgan Other');
  const [provider] = await testDataSource.query(
    'INSERT INTO providers (user_id, display_name) VALUES ($1, $2) RETURNING id',
    [ownerId, 'Billing Provider'],
  );
  providerId = provider.id as string;
  const [treatment] = await testDataSource.query(
    `INSERT INTO treatment_types (name, procedure_code, default_duration_minutes, default_price_cents, is_active)
     VALUES ($1, 'D0120', 30, 12500, true) RETURNING id`,
    [NAME_SENTINEL],
  );
  treatmentTypeId = treatment.id as string;
  http = supertest(app.getHttpServer());
  ownerCookie = await login(ownerEmail);
  receptionistCookie = await login(receptionistEmail);
});

afterAll(async () => {
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('billing permissions and auth', () => {
  it('returns 401 without a session and 403 without the CSRF header', async () => {
    await http.get('/invoices').expect(401);
    await http.get(`/patients/${patientId}/billable`).expect(401);
    await http.post(`/patients/${patientId}/invoices`).set(CSRF).send({}).expect(401);
    await http.post(`/patients/${patientId}/invoices`).set('Cookie', ownerCookie).send({}).expect(403);
    await http.post('/invoices/' + randomUUID() + '/issue').set('Cookie', ownerCookie).expect(403);
    await http.delete('/invoices/' + randomUUID()).set('Cookie', ownerCookie).expect(403);
  });

  it('keeps performed-treatment create and delete dentist-owner only', async () => {
    const appointmentId = await createAppointment(AppointmentStatus.InProgress);
    await receptionist(http.post(`/appointments/${appointmentId}/performed-treatments`))
      .send({ treatmentTypeId })
      .expect(403);
    const treatment = await performTreatment();
    await receptionist(http.delete(`/performed-treatments/${treatment.id}`)).expect(403);
    await owner(http.delete(`/performed-treatments/${treatment.id}`)).expect(200);
  });

  it('lets the receptionist do everything else', async () => {
    const treatment = await performTreatment({ priceCents: 5000 });
    await receptionist(http.get(`/patients/${patientId}/billable`)).expect(200);
    const created = await receptionist(http.post(`/patients/${patientId}/invoices`))
      .send({ performedTreatmentIds: [treatment.id] })
      .expect(201);
    const manual = await receptionist(http.post(`/invoices/${created.body.id}/lines`))
      .send({ description: 'Manual', unitPriceCents: 100, quantity: 2 })
      .expect(201);
    expect(manual.body.lines).toHaveLength(2);
    const manualLine = manual.body.lines.find((l: { performedTreatmentId: string | null }) => !l.performedTreatmentId);
    await receptionist(http.delete(`/invoices/${created.body.id}/lines/${manualLine.id}`)).expect(200);
    await receptionist(http.post(`/invoices/${created.body.id}/issue`)).expect(201);
    await receptionist(http.get(`/invoices/${created.body.id}`)).expect(200);
    await receptionist(http.get('/invoices')).expect(200);
    await receptionist(http.get(`/patients/${patientId}/invoices`)).expect(200);
    const other = await issuableInvoice();
    await receptionist(http.delete(`/invoices/${other.id}`)).expect(200);
  });
});

describe('performed treatments', () => {
  it('only allows in-progress or completed appointments and active treatment types', async () => {
    for (const status of [AppointmentStatus.Scheduled, AppointmentStatus.Cancelled]) {
      const id = await createAppointment(status, patientId, 30 + counter++);
      await owner(http.post(`/appointments/${id}/performed-treatments`)).send({ treatmentTypeId }).expect(409);
    }
    const completed = await createAppointment(AppointmentStatus.Completed, patientId, 60);
    await owner(http.post(`/appointments/${completed}/performed-treatments`)).send({ treatmentTypeId, toothNumber: 14 }).expect(201);
    await owner(http.post(`/appointments/${completed}/performed-treatments`)).send({ treatmentTypeId, toothNumber: 33 }).expect(400);
    await testDataSource.query('UPDATE treatment_types SET is_active = false WHERE id = $1', [treatmentTypeId]);
    await owner(http.post(`/appointments/${completed}/performed-treatments`)).send({ treatmentTypeId }).expect(400);
    await owner(http.post(`/appointments/${randomUUID()}/performed-treatments`)).send({ treatmentTypeId }).expect(404);
  });

  it('freezes the default catalogue price and honours an explicit price', async () => {
    const treatment = await performTreatment();
    expect(treatment.priceCents).toBe(12500);
    await testDataSource.query('UPDATE treatment_types SET default_price_cents = 99999 WHERE id = $1', [treatmentTypeId]);
    const billable = await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(billable.body.items[0].priceCents).toBe(12500);
    expect(billable.body.currencyCode).toBe('LSL');
    const explicit = await performTreatment({ priceCents: 777 });
    expect(explicit.priceCents).toBe(777);
  });

  it('creates exactly one performed treatment when a plan item is done with an appointment, and 409s the second time', async () => {
    const appointmentId = await createAppointment(AppointmentStatus.InProgress);
    const plan = await owner(http.post(`/patients/${patientId}/treatment-plans`))
      .send({ items: [{ treatmentTypeId, toothNumber: 14 }, { treatmentTypeId }] })
      .expect(201);
    const [first, second] = plan.body.items;
    const url = (id: string) => `/treatment-plans/${plan.body.id}/items/${id}/status`;
    await owner(http.patch(url(first.id))).send({ status: PlanStatus.Accepted }).expect(200);
    await owner(http.patch(url(second.id))).send({ status: PlanStatus.Accepted }).expect(200);
    await testDataSource.query('TRUNCATE audit_log');

    const done = await owner(http.patch(url(first.id))).send({ status: PlanStatus.Done, appointmentId }).expect(200);
    expect(done.body.performedTreatment).toMatchObject({ planItemId: first.id, toothNumber: 14, priceCents: 12500 });
    const rows = await auditRows();
    expect(rows.map((r: { action: string }) => r.action).sort()).toEqual([
      'billing.performed_treatment.create',
      'clinical.plan_item.status_change',
    ]);
    expect(rows.every((r: { patient_id: string }) => r.patient_id === patientId)).toBe(true);

    await owner(http.patch(url(first.id))).send({ status: PlanStatus.Done, appointmentId }).expect(409);
    const [{ count }] = await testDataSource.query(
      'SELECT count(*)::int AS count FROM performed_treatments WHERE plan_item_id = $1',
      [first.id],
    );
    expect(count).toBe(1);

    await owner(http.patch(url(second.id))).send({ status: PlanStatus.Done }).expect(200);
    const [{ total }] = await testDataSource.query('SELECT count(*)::int AS total FROM performed_treatments');
    expect(total).toBe(1);
  });

  it('rejects a plan-item done with an invalid appointment and rolls back the status change', async () => {
    const plan = await owner(http.post(`/patients/${patientId}/treatment-plans`)).send({ items: [{ treatmentTypeId }] }).expect(201);
    const item = plan.body.items[0];
    const url = `/treatment-plans/${plan.body.id}/items/${item.id}/status`;
    await owner(http.patch(url)).send({ status: PlanStatus.Accepted }).expect(200);
    const foreign = await createAppointment(AppointmentStatus.InProgress, otherPatientId, 5);
    const scheduled = await createAppointment(AppointmentStatus.Scheduled, patientId, 8);
    await owner(http.patch(url)).send({ status: PlanStatus.Done, appointmentId: foreign }).expect(400);
    await owner(http.patch(url)).send({ status: PlanStatus.Done, appointmentId: scheduled }).expect(409);
    await owner(http.patch(url)).send({ status: PlanStatus.Declined, appointmentId: scheduled }).expect(400);
    const [row] = await testDataSource.query('SELECT status FROM treatment_plan_items WHERE id = $1', [item.id]);
    expect(row.status).toBe('accepted');
  });

  it('deletes only unbilled performed treatments', async () => {
    const treatment = await performTreatment();
    await draftInvoice([treatment.id]);
    await owner(http.delete(`/performed-treatments/${treatment.id}`)).expect(409);
    const free = await performTreatment();
    await owner(http.delete(`/performed-treatments/${free.id}`)).expect(200);
    await owner(http.delete(`/performed-treatments/${free.id}`)).expect(404);
  });
});

describe('invoice flow', () => {
  it('drafts from all unbilled treatments, never double-bills, and 409s when nothing is billable', async () => {
    await owner(http.post(`/patients/${patientId}/invoices`)).send({}).expect(409);
    const a = await performTreatment({ priceCents: 1000, toothNumber: 11 });
    const b = await performTreatment({ priceCents: 2500 });
    const invoice = await draftInvoice();
    expect(invoice.status).toBe('draft');
    expect(invoice.invoiceNumber).toBeNull();
    expect(invoice.paymentStatus).toBeNull();
    expect(invoice.totalCents).toBe(3500);
    expect(invoice.currencyCode).toBe('LSL');
    expect(invoice.lines).toHaveLength(2);
    const lineA = invoice.lines.find((l: { performedTreatmentId: string }) => l.performedTreatmentId === a.id);
    expect(lineA).toMatchObject({ description: NAME_SENTINEL, procedureCode: 'D0120', toothNumber: 11, quantity: 1, unitPriceCents: 1000 });
    await owner(http.post(`/patients/${patientId}/invoices`)).send({ performedTreatmentIds: [a.id] }).expect(409);
    await owner(http.post(`/patients/${patientId}/invoices`)).send({}).expect(409);
    const billable = await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(billable.body.items).toHaveLength(0);
    const second = await owner(http.post(`/patients/${patientId}/invoices`)).send({ performedTreatmentIds: [b.id] });
    expect(second.status).toBe(409);
  });

  it('rejects other patients\' treatments and archived patients', async () => {
    const foreign = await performTreatment({}, otherPatientId);
    await owner(http.post(`/patients/${patientId}/invoices`)).send({ performedTreatmentIds: [foreign.id] }).expect(400);
    await performTreatment();
    await testDataSource.query('UPDATE patients SET archived_at = now() WHERE id = $1', [patientId]);
    await owner(http.post(`/patients/${patientId}/invoices`)).send({}).expect(409);
  });

  it('makes a treatment billable again when its line is removed', async () => {
    const treatment = await performTreatment({ priceCents: 1000 });
    const invoice = await draftInvoice([treatment.id]);
    const removed = await owner(http.delete(`/invoices/${invoice.id}/lines/${invoice.lines[0].id}`)).expect(200);
    expect(removed.body.lines).toHaveLength(0);
    const billable = await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(billable.body.items.map((i: { id: string }) => i.id)).toEqual([treatment.id]);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ performedTreatmentId: treatment.id }).expect(201);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ performedTreatmentId: treatment.id }).expect(409);
    await owner(http.delete(`/invoices/${invoice.id}/lines/${randomUUID()}`)).expect(404);
  });

  it('supports manual lines with validation and deletes drafts', async () => {
    const invoice = await issuableInvoice(1000);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ unitPriceCents: 5 }).expect(400);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ description: '', unitPriceCents: 5 }).expect(400);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ description: 'x', unitPriceCents: 5, quantity: 100 }).expect(400);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ description: 'x', unitPriceCents: -5 }).expect(400);
    const added = await owner(http.post(`/invoices/${invoice.id}/lines`))
      .send({ description: 'Whitening kit', unitPriceCents: 250, quantity: 3 })
      .expect(201);
    expect(added.body.totalCents).toBe(1750);
    const issuedInvoice = await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(201);
    expect(issuedInvoice.body.totalCents).toBe(1750);

    const toDelete = await issuableInvoice();
    await owner(http.delete(`/invoices/${toDelete.id}`)).expect(200);
    await owner(http.get(`/invoices/${toDelete.id}`)).expect(404);
    const billable = await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(billable.body.items).toHaveLength(1);
  });

  it('rejects every edit to an issued invoice, with the database as backstop', async () => {
    const invoice = await issued(1000);
    const detail = await owner(http.get(`/invoices/${invoice.id}`)).expect(200);
    const lineId = detail.body.lines[0].id;
    const treatment = await performTreatment();
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ performedTreatmentId: treatment.id }).expect(409);
    await owner(http.post(`/invoices/${invoice.id}/lines`)).send({ description: 'x', unitPriceCents: 1 }).expect(409);
    await owner(http.delete(`/invoices/${invoice.id}/lines/${lineId}`)).expect(409);
    await owner(http.delete(`/invoices/${invoice.id}`)).expect(409);
    await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(409);
    await expect(testDataSource.query('DELETE FROM invoice_lines WHERE id = $1', [lineId])).rejects.toBeInstanceOf(QueryFailedError);
    await expect(testDataSource.query('UPDATE invoices SET total_cents = 1 WHERE id = $1', [invoice.id])).rejects.toBeInstanceOf(QueryFailedError);
    await expect(testDataSource.query('DELETE FROM invoices WHERE id = $1', [invoice.id])).rejects.toBeInstanceOf(QueryFailedError);
    await expect(
      testDataSource.query(
        `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_cents, line_total_cents) VALUES ($1, 'x', 1, 1, 1)`,
        [invoice.id],
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('refuses to issue an empty or zero-total invoice and lists with filters', async () => {
    const zero = await issuableInvoice(0);
    await owner(http.post(`/invoices/${zero.id}/issue`)).expect(409);
    await owner(http.delete(`/invoices/${zero.id}/lines/${zero.lines[0].id}`)).expect(200);
    await owner(http.post(`/invoices/${zero.id}/issue`)).expect(409);

    const one = await issued(1000);
    const two = await issued(2000);
    await addPayment(two.id, 2000);
    const all = await owner(http.get('/invoices')).expect(200);
    expect(all.body.items.length).toBe(3);
    expect(all.body.page).toBe(1);
    const onlyIssued = await owner(http.get('/invoices?status=issued')).expect(200);
    expect(onlyIssued.body.items).toHaveLength(2);
    const drafts = await owner(http.get('/invoices?status=draft')).expect(200);
    expect(drafts.body.items).toHaveLength(1);
    const paid = await owner(http.get('/invoices?paymentStatus=paid')).expect(200);
    expect(paid.body.items.map((i: { id: string }) => i.id)).toEqual([two.id]);
    const unpaid = await owner(http.get(`/invoices?paymentStatus=unpaid&patientId=${patientId}`)).expect(200);
    expect(unpaid.body.items.map((i: { id: string }) => i.id)).toEqual([one.id]);
    const mine = await owner(http.get(`/patients/${patientId}/invoices`)).expect(200);
    expect(mine.body.items).toHaveLength(3);
    const none = await owner(http.get(`/patients/${otherPatientId}/invoices`)).expect(200);
    expect(none.body.items).toHaveLength(0);
    await owner(http.get('/invoices?pageSize=51')).expect(400);
    const future = await owner(http.get('/invoices?from=2999-01-01')).expect(200);
    expect(future.body.items).toHaveLength(0);
    const billable = await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(billable.body.outstandingBalanceCents).toBe(1000);
  });
});

describe('gapless invoice numbering', () => {
  it('issues INV-000001..3 with no gaps', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await issued()).invoiceNumber);
    expect(numbers).toEqual(['INV-000001', 'INV-000002', 'INV-000003']);
    expect(await counterValue()).toBe(3);
  });

  it('does not consume a number when an issue fails after the counter was taken', async () => {
    expect((await issued()).invoiceNumber).toBe('INV-000001');
    const draft = await issuableInvoice();
    const original = AuditService.prototype.record;
    const spy = jest.spyOn(AuditService.prototype, 'record').mockImplementation(function (this: AuditService, record, manager) {
      if (record.action === 'billing.invoice.issue') return Promise.reject(new Error('forced audit failure'));
      return original.call(this, record, manager);
    });
    const failed = await owner(http.post(`/invoices/${draft.id}/issue`));
    expect(failed.status).toBe(500);
    expect(failed.body).toHaveProperty('statusCode', 500);
    expect(await counterValue()).toBe(1);
    const [row] = await testDataSource.query('SELECT status, invoice_number FROM invoices WHERE id = $1', [draft.id]);
    expect(row).toEqual({ status: 'draft', invoice_number: null });
    spy.mockRestore();
    const next = await owner(http.post(`/invoices/${draft.id}/issue`)).expect(201);
    expect(next.body.invoiceNumber).toBe('INV-000002');
    expect(await counterValue()).toBe(2);
  });

  it('gives 5 simultaneous issues 5 distinct consecutive numbers', async () => {
    const drafts = [];
    for (let i = 0; i < 5; i += 1) drafts.push(await issuableInvoice(1000 + i));
    const responses = await Promise.all(drafts.map((d) => owner(http.post(`/invoices/${d.id}/issue`))));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = responses.map((r) => r.body.invoiceNumber as string).sort();
    expect(numbers).toEqual(['INV-000001', 'INV-000002', 'INV-000003', 'INV-000004', 'INV-000005']);
    expect(await counterValue()).toBe(5);
  });

  it('serialises concurrent issues of the same invoice into one success and one 409', async () => {
    const draft = await issuableInvoice();
    const responses = await Promise.all([
      owner(http.post(`/invoices/${draft.id}/issue`)),
      owner(http.post(`/invoices/${draft.id}/issue`)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await counterValue()).toBe(1);
  });
});

describe('computed invoice fields', () => {
  async function fields(id: string) {
    const response = await owner(http.get(`/invoices/${id}`)).expect(200);
    const { paymentStatus, creditedCents, paidCents, balanceCents } = response.body;
    return { paymentStatus, creditedCents, paidCents, balanceCents, body: response.body };
  }

  it('derives unpaid, part_paid, paid, overpaid and cancelled', async () => {
    const unpaid = await issued(1000);
    expect(await fields(unpaid.id)).toMatchObject({ paymentStatus: 'unpaid', paidCents: 0, creditedCents: 0, balanceCents: 1000 });

    const part = await issued(1000);
    await addPayment(part.id, 400);
    expect(await fields(part.id)).toMatchObject({ paymentStatus: 'part_paid', paidCents: 400, balanceCents: 600 });

    const paid = await issued(1000);
    await addPayment(paid.id, 1000);
    expect(await fields(paid.id)).toMatchObject({ paymentStatus: 'paid', balanceCents: 0 });

    const paidViaCredit = await issued(1000);
    await addCredit(paidViaCredit.id, 600);
    await addPayment(paidViaCredit.id, 400);
    expect(await fields(paidViaCredit.id)).toMatchObject({ paymentStatus: 'paid', balanceCents: 0, creditedCents: 600 });

    const over = await issued(1000);
    await addPayment(over.id, 1500);
    expect(await fields(over.id)).toMatchObject({ paymentStatus: 'overpaid', balanceCents: -500 });

    const cancelled = await issued(1000);
    await addCredit(cancelled.id, 1000);
    expect(await fields(cancelled.id)).toMatchObject({ paymentStatus: 'cancelled', balanceCents: 0, creditedCents: 1000 });
  });

  it('reports a fully paid then fully credited invoice as overpaid, not cancelled', async () => {
    const invoice = await issued(1000);
    await addPayment(invoice.id, 1000);
    await addCredit(invoice.id, 1000);
    expect(await fields(invoice.id)).toMatchObject({ paymentStatus: 'overpaid', balanceCents: -1000 });
  });

  it('includes payments and credit notes in the detail response', async () => {
    const invoice = await issued(1000);
    await addPayment(invoice.id, 100);
    await addCredit(invoice.id, 50);
    const { body } = await fields(invoice.id);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ method: 'cash', amountCents: 100 });
    expect(body.creditNotes).toHaveLength(1);
    expect(body.creditNotes[0]).toMatchObject({ amountCents: 50 });
  });

  it('rejects UPDATE and DELETE on payments and credit_notes', async () => {
    const invoice = await issued(1000);
    await addPayment(invoice.id, 100);
    await addCredit(invoice.id, 50);
    for (const sql of [
      'UPDATE payments SET amount_cents = 1',
      'DELETE FROM payments',
      `UPDATE credit_notes SET reason = 'changed'`,
      'DELETE FROM credit_notes',
    ]) {
      await expect(testDataSource.query(sql)).rejects.toBeInstanceOf(QueryFailedError);
    }
  });
});

describe('billing audit', () => {
  it('writes exactly one row per action with the right patient_id', async () => {
    const treatment = await performTreatment({ priceCents: PRICE_SENTINEL });
    const free = await performTreatment();
    await owner(http.delete(`/performed-treatments/${free.id}`)).expect(200);
    const invoice = await draftInvoice([treatment.id]);
    const added = await owner(http.post(`/invoices/${invoice.id}/lines`))
      .send({ description: DESC_SENTINEL, unitPriceCents: MANUAL_PRICE_SENTINEL })
      .expect(201);
    const manualLine = added.body.lines.find((l: { performedTreatmentId: string | null }) => !l.performedTreatmentId);
    await owner(http.delete(`/invoices/${invoice.id}/lines/${manualLine.id}`)).expect(200);
    await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(201);
    await owner(http.get(`/invoices/${invoice.id}`)).expect(200);
    const doomed = await issuableInvoice();
    await owner(http.delete(`/invoices/${doomed.id}`)).expect(200);

    const rows = await auditRows(`action LIKE 'billing.%'`);
    const count = (action: string) => rows.filter((r: { action: string }) => r.action === action).length;
    expect(count('billing.performed_treatment.create')).toBe(3);
    expect(count('billing.performed_treatment.delete')).toBe(1);
    expect(count('billing.invoice.create')).toBe(2);
    expect(count('billing.invoice.line_add')).toBe(1);
    expect(count('billing.invoice.line_remove')).toBe(1);
    expect(count('billing.invoice.issue')).toBe(1);
    expect(count('billing.invoice.view')).toBe(1);
    expect(count('billing.invoice.delete')).toBe(1);
    expect(rows).toHaveLength(11);
    expect(rows.every((r: { patient_id: string }) => r.patient_id === patientId)).toBe(true);
  });

  it('does not audit list endpoints or billable', async () => {
    await issued();
    await testDataSource.query('TRUNCATE audit_log');
    await owner(http.get('/invoices')).expect(200);
    await owner(http.get(`/patients/${patientId}/invoices`)).expect(200);
    await owner(http.get(`/patients/${patientId}/billable`)).expect(200);
    expect(await auditRows()).toHaveLength(0);
  });

  it('never stores amounts, descriptions or names in audit rows', async () => {
    await testDataSource.query('UPDATE treatment_types SET name = $1', [`${NAME_SENTINEL}`]);
    const treatment = await performTreatment({ priceCents: PRICE_SENTINEL });
    const invoice = await draftInvoice([treatment.id]);
    await owner(http.post(`/invoices/${invoice.id}/lines`))
      .send({ description: DESC_SENTINEL, unitPriceCents: MANUAL_PRICE_SENTINEL })
      .expect(201);
    await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(201);
    await owner(http.get(`/invoices/${invoice.id}`)).expect(200);
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);
    const json = JSON.stringify(rows);
    for (const sentinel of [String(PRICE_SENTINEL), String(MANUAL_PRICE_SENTINEL), DESC_SENTINEL, NAME_SENTINEL, 'INV-0']) {
      expect(json).not.toContain(sentinel);
    }
  });

  it('rolls back an issue and a performed-treatment create when the audit write throws', async () => {
    const draft = await issuableInvoice();
    const appointmentId = await createAppointment(AppointmentStatus.InProgress, patientId, 40);
    const spy = jest.spyOn(AuditService.prototype, 'record').mockRejectedValue(new Error('audit down'));
    await owner(http.post(`/invoices/${draft.id}/issue`)).expect(500);
    await owner(http.post(`/appointments/${appointmentId}/performed-treatments`)).send({ treatmentTypeId }).expect(500);
    spy.mockRestore();
    const [invoice] = await testDataSource.query('SELECT status, invoice_number FROM invoices WHERE id = $1', [draft.id]);
    expect(invoice).toEqual({ status: 'draft', invoice_number: null });
    expect(await counterValue()).toBe(0);
    const [{ n }] = await testDataSource.query('SELECT count(*)::int AS n FROM performed_treatments WHERE appointment_id = $1', [appointmentId]);
    expect(n).toBe(0);
  });
});

describe('response shape', () => {
  it('exposes no internal columns and uses the standard error format', async () => {
    const invoice = await issued(1000);
    const detail = await owner(http.get(`/invoices/${invoice.id}`)).expect(200);
    const json = JSON.stringify(detail.body);
    for (const column of ['created_by', 'issued_by', 'patient_id', 'invoice_id', 'received_by', 'password', 'total_cents', 'line_total_cents']) {
      expect(json).not.toContain(`"${column}"`);
    }
    expect(Object.keys(detail.body.lines[0]).sort()).toEqual(
      ['description', 'id', 'lineTotalCents', 'performedTreatmentId', 'procedureCode', 'quantity', 'toothNumber', 'unitPriceCents'],
    );
    const treatment = await performTreatment();
    expect(Object.keys(treatment).sort()).toEqual(
      ['appointmentId', 'currencyCode', 'id', 'patientId', 'performedAt', 'planItemId', 'priceCents', 'toothNumber', 'treatmentTypeId'],
    );

    const conflict = await owner(http.post(`/invoices/${invoice.id}/issue`)).expect(409);
    expect(conflict.body).toEqual({ statusCode: 409, error: 'Conflict', message: ['Issued invoices cannot be changed'] });
    const missing = await owner(http.get(`/invoices/${randomUUID()}`)).expect(404);
    expect(missing.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(Array.isArray(missing.body.message)).toBe(true);
    const invalid = await owner(http.get('/invoices/not-a-uuid')).expect(400);
    expect(invalid.body).toMatchObject({ statusCode: 400 });
  });
});
