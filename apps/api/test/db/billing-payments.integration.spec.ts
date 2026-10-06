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


const password = 'billing payments integration password';
const NAME_SENTINEL = 'BILLING_NAME_SENTINEL';
const INVOICE_SENTINEL = 8765432;
const PAYMENT_SENTINEL = 7654321;
const CREDIT_SENTINEL = 1234567;
const REASON_SENTINEL = 'CN_REASON_SENTINEL';
const REFERENCE_SENTINEL = 'PAY_REF_SENTINEL';
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


const pay = (invoiceId: string, body: Record<string, unknown>) =>
  owner(http.post(`/invoices/${invoiceId}/payments`)).send(body);
const credit = (invoiceId: string, body: Record<string, unknown>) =>
  owner(http.post(`/invoices/${invoiceId}/credit-notes`)).send(body);

async function detail(id: string) {
  return (await owner(http.get(`/invoices/${id}`)).expect(200)).body;
}

describe('payments and credit notes: permissions and auth', () => {
  it('returns 401 without a session and 403 without the CSRF header', async () => {
    const invoice = await issued(1000);
    await http.post(`/invoices/${invoice.id}/payments`).set(CSRF).send({ method: 'cash', amountCents: 1 }).expect(401);
    await http.post(`/invoices/${invoice.id}/credit-notes`).set(CSRF).send({ amountCents: 1, reason: 'x' }).expect(401);
    await http.get('/reports/cash-up?date=2026-03-10').expect(401);
    await http.post(`/invoices/${invoice.id}/payments`).set('Cookie', ownerCookie).send({ method: 'cash', amountCents: 1 }).expect(403);
    await http.post(`/invoices/${invoice.id}/credit-notes`).set('Cookie', ownerCookie).send({ amountCents: 1, reason: 'x' }).expect(403);
  });

  it('keeps credit notes dentist-owner only while the receptionist can take payments and view cash-up', async () => {
    const invoice = await issued(1000);
    await receptionist(http.post(`/invoices/${invoice.id}/credit-notes`)).send({ amountCents: 100, reason: 'x' }).expect(403);
    await receptionist(http.post(`/invoices/${invoice.id}/payments`)).send({ method: 'card', amountCents: 100 }).expect(201);
    await receptionist(http.get('/reports/cash-up?date=2026-03-10')).expect(200);
    await owner(http.post(`/invoices/${invoice.id}/credit-notes`)).send({ amountCents: 100, reason: 'x' }).expect(201);
    expect(await auditRows(`action = 'billing.credit_note.create'`)).toHaveLength(1);
  });
});

describe('payments', () => {
  it('moves unpaid -> part_paid -> paid and records the receiving user', async () => {
    const invoice = await issued(1000);
    expect((await detail(invoice.id)).paymentStatus).toBe('unpaid');
    const first = await pay(invoice.id, { method: 'cash', amountCents: 400, reference: 'ref-1' }).expect(201);
    expect(first.body).toMatchObject({ method: 'cash', amountCents: 400, reference: 'ref-1', currencyCode: 'LSL' });
    expect(first.body.invoice).toMatchObject({ paymentStatus: 'part_paid', paidCents: 400, balanceCents: 600 });
    const second = await receptionist(http.post(`/invoices/${invoice.id}/payments`)).send({ method: 'card', amountCents: 600 }).expect(201);
    expect(second.body.invoice).toMatchObject({ paymentStatus: 'paid', balanceCents: 0 });
    const rows = await testDataSource.query('SELECT received_by FROM payments ORDER BY paid_at');
    expect(rows.map((r: { received_by: string }) => r.received_by)).toEqual([ownerId, rows[1].received_by]);
    expect(rows[1].received_by).not.toBe(ownerId);
    const full = await detail(invoice.id);
    expect(full.payments).toHaveLength(2);
    expect(full.paymentStatus).toBe('paid');
  });

  it('rejects overpayment with 409 stating the balance, insurance and bad input with 400, and drafts', async () => {
    const invoice = await issued(1000);
    await pay(invoice.id, { method: 'cash', amountCents: 300 }).expect(201);
    const over = await pay(invoice.id, { method: 'cash', amountCents: 701 }).expect(409);
    expect(over.body.message[0]).toContain('700');
    await pay(invoice.id, { method: 'insurance', amountCents: 100 }).expect(400);
    await pay(invoice.id, { method: 'cash', amountCents: 0 }).expect(400);
    await pay(invoice.id, { method: 'cash', amountCents: -5 }).expect(400);
    await pay(invoice.id, { method: 'cash', amountCents: 1.5 }).expect(400);
    await pay(invoice.id, { method: 'cash' }).expect(400);
    await pay(randomUUID(), { method: 'cash', amountCents: 1 }).expect(404);
    await pay(invoice.id, { method: 'cash', amountCents: 700 }).expect(201);
    await pay(invoice.id, { method: 'cash', amountCents: 1 }).expect(409);
    const draft = await issuableInvoice();
    await pay(draft.id, { method: 'cash', amountCents: 1 }).expect(409);
    const [{ n }] = await testDataSource.query('SELECT count(*)::int AS n FROM payments');
    expect(n).toBe(2);
  });

  it('never overpays under 5 simultaneous payments (repeated 5 times)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const invoice = await issued(1000);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => pay(invoice.id, { method: 'cash', amountCents: 300 })),
      );
      const accepted = responses.filter((r) => r.status === 201).length;
      expect(responses.filter((r) => r.status === 409).length).toBe(5 - accepted);
      expect(accepted).toBe(3);
      const [{ sum }] = await testDataSource.query(
        'SELECT COALESCE(SUM(amount_cents), 0)::int AS sum FROM payments WHERE invoice_id = $1',
        [invoice.id],
      );
      expect(sum).toBe(900);
      expect(sum).toBeLessThanOrEqual(1000);
    }
  });

  it('refuses to change or remove payments', async () => {
    const invoice = await issued(1000);
    await pay(invoice.id, { method: 'cash', amountCents: 100 }).expect(201);
    await expect(testDataSource.query('UPDATE payments SET amount_cents = 1')).rejects.toBeInstanceOf(QueryFailedError);
    await expect(testDataSource.query('DELETE FROM payments')).rejects.toBeInstanceOf(QueryFailedError);
  });
});

describe('credit notes', () => {
  it('cannot exceed the creditable remainder and requires a reason', async () => {
    const invoice = await issued(1000);
    await credit(invoice.id, { amountCents: 1000 }).expect(400);
    await credit(invoice.id, { amountCents: 1000, reason: '   ' }).expect(400);
    await credit(invoice.id, { amountCents: 0, reason: 'x' }).expect(400);
    await credit(invoice.id, { amountCents: 1001, reason: 'x' }).expect(409);
    await credit(invoice.id, { amountCents: 700, reason: 'x' }).expect(201);
    const over = await credit(invoice.id, { amountCents: 301, reason: 'x' }).expect(409);
    expect(over.body.message[0]).toContain('300');
    await credit(invoice.id, { amountCents: 300, reason: 'x' }).expect(201);
    await credit(invoice.id, { amountCents: 1, reason: 'x' }).expect(409);
    const draft = await issuableInvoice();
    await credit(draft.id, { amountCents: 1, reason: 'x' }).expect(409);
    await credit(randomUUID(), { amountCents: 1, reason: 'x' }).expect(404);
    const full = await detail(invoice.id);
    expect(full.totalCents).toBe(1000);
    expect(full.status).toBe('issued');
  });

  it('cancels a fully credited unpaid invoice and shows overpaid for a credited paid one', async () => {
    const unpaid = await issued(1000);
    const cancelled = await credit(unpaid.id, { amountCents: 1000, reason: 'void' }).expect(201);
    expect(cancelled.body.invoice).toMatchObject({ paymentStatus: 'cancelled', balanceCents: 0, creditedCents: 1000 });

    const paid = await issued(1000);
    await pay(paid.id, { method: 'cash', amountCents: 1000 }).expect(201);
    const over = await credit(paid.id, { amountCents: 400, reason: 'goodwill' }).expect(201);
    expect(over.body.invoice).toMatchObject({ paymentStatus: 'overpaid', balanceCents: -400 });
    const full = await credit(paid.id, { amountCents: 600, reason: 'goodwill' }).expect(201);
    expect(full.body.invoice).toMatchObject({ paymentStatus: 'overpaid', balanceCents: -1000 });
    await pay(paid.id, { method: 'cash', amountCents: 1 }).expect(409);
  });

  it('numbers credit notes CN-000001.. gaplessly, independent of invoice numbers', async () => {
    const invoice = await issued(1000);
    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await credit(invoice.id, { amountCents: 10, reason: 'r' }).expect(201)).body.creditNoteNumber);
    expect(numbers).toEqual(['CN-000001', 'CN-000002', 'CN-000003']);
    expect(await counterValue()).toBe(1);
  });

  it('leaves the counter unchanged when a credit note fails after taking a number', async () => {
    const invoice = await issued(1000);
    await credit(invoice.id, { amountCents: 10, reason: 'r' }).expect(201);
    const original = AuditService.prototype.record;
    const spy = jest.spyOn(AuditService.prototype, 'record').mockImplementation(function (this: AuditService, record, manager) {
      if (record.action === 'billing.credit_note.create') return Promise.reject(new Error('forced audit failure'));
      return original.call(this, record, manager);
    });
    const failed = await credit(invoice.id, { amountCents: 10, reason: 'r' });
    expect(failed.status).toBe(500);
    spy.mockRestore();
    const [{ last_value: value }] = await testDataSource.query(`SELECT last_value::int FROM document_counters WHERE name = 'credit_note'`);
    expect(value).toBe(1);
    const [{ n }] = await testDataSource.query('SELECT count(*)::int AS n FROM credit_notes');
    expect(n).toBe(1);
    const next = await credit(invoice.id, { amountCents: 10, reason: 'r' }).expect(201);
    expect(next.body.creditNoteNumber).toBe('CN-000002');
  });

  it('gives 5 simultaneous credit notes 5 distinct consecutive numbers', async () => {
    const invoice = await issued(5000);
    const responses = await Promise.all(Array.from({ length: 5 }, () => credit(invoice.id, { amountCents: 100, reason: 'r' })));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(responses.map((r) => r.body.creditNoteNumber as string).sort()).toEqual([
      'CN-000001', 'CN-000002', 'CN-000003', 'CN-000004', 'CN-000005',
    ]);
  });

  it('refuses to change or remove credit notes', async () => {
    const invoice = await issued(1000);
    await credit(invoice.id, { amountCents: 10, reason: 'r' }).expect(201);
    await expect(testDataSource.query(`UPDATE credit_notes SET reason = 'x'`)).rejects.toBeInstanceOf(QueryFailedError);
    await expect(testDataSource.query('DELETE FROM credit_notes')).rejects.toBeInstanceOf(QueryFailedError);
  });
});

describe('cash-up report', () => {
  async function paymentAt(invoiceId: string, amount: number, paidAt: string, method = 'cash', userId = ownerId) {
    await testDataSource.query(
      `INSERT INTO payments (invoice_id, method, amount_cents, received_by, paid_at) VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, method, amount, userId, paidAt],
    );
  }

  async function seed() {
    const invoice = await issued(100000);
    const [{ id: receptionistId }] = await testDataSource.query(`SELECT id FROM users WHERE email = $1`, [receptionistEmail]);
    // Clinic zone is Africa/Maseru (UTC+2): local 2026-03-10 spans 2026-03-09T22:00Z to 2026-03-10T22:00Z.
    await paymentAt(invoice.id, 1, '2026-03-09T21:59:59Z');
    await paymentAt(invoice.id, 10, '2026-03-09T22:00:00Z');
    await paymentAt(invoice.id, 100, '2026-03-10T12:00:00Z', 'card', receptionistId);
    await paymentAt(invoice.id, 1000, '2026-03-10T21:59:59Z', 'cash', receptionistId);
    await paymentAt(invoice.id, 10000, '2026-03-10T22:00:00Z');
    return receptionistId as string;
  }

  const expected = (receptionistId: string) => ({
    byMethod: [
      { method: 'cash', totalCents: 1010, count: 2 },
      { method: 'card', totalCents: 100, count: 1 },
    ],
    byUser: [
      { userId: ownerId, totalCents: 10, count: 1 },
      { userId: receptionistId, totalCents: 1100, count: 2 },
    ],
    grandTotalCents: 1110,
  });

  async function checkDay(receptionistId: string) {
    const response = await receptionist(http.get('/reports/cash-up?date=2026-03-10')).expect(200);
    const want = expected(receptionistId);
    expect(response.body.byMethod).toEqual(want.byMethod);
    expect(response.body.byUser.map(({ fullName: _name, ...rest }: Record<string, unknown>) => rest).sort(
      (a: { totalCents: number }, b: { totalCents: number }) => a.totalCents - b.totalCents,
    )).toEqual(want.byUser);
    expect(response.body).toMatchObject({ date: '2026-03-10', currencyCode: 'LSL', grandTotalCents: 1110, paymentCount: 3 });
    const prev = await owner(http.get('/reports/cash-up?date=2026-03-09')).expect(200);
    expect(prev.body.grandTotalCents).toBe(1);
    const next = await owner(http.get('/reports/cash-up?date=2026-03-11')).expect(200);
    expect(next.body.grandTotalCents).toBe(10000);
  }

  it('puts payments near clinic-local midnight on the right date with correct totals', async () => {
    await checkDay(await seed());
  });

  // The process timezone can only be set before Node starts (runtime TZ changes are ignored on
  // Windows), so scripts/run-db-tests.cjs launches these with TZ set and CASHUP_TZ naming the zone.
  const tzIt = (zone: string) => (process.env.CASHUP_TZ === zone ? it : it.skip);
  const zoneOffsets: Record<string, number> = { 'Pacific/Kiritimati': -840, 'America/Los_Angeles': 420 };

  for (const zone of Object.keys(zoneOffsets)) {
    tzIt(zone)(`gives the same result with process TZ ${zone}`, async () => {
      expect(new Date('2026-03-10T12:00:00Z').getTimezoneOffset()).toBe(zoneOffsets[zone]);
      await checkDay(await seed());
    });
  }
  it('follows the clinic timezone setting and validates the date', async () => {
    await testDataSource.query(`UPDATE clinic_settings SET timezone = 'America/Los_Angeles'`);
    const invoice = await issued(1000);
    await paymentAt(invoice.id, 5, '2026-03-10T06:59:59Z'); // 2026-03-09 23:59:59 PDT
    await paymentAt(invoice.id, 7, '2026-03-10T07:00:00Z'); // 2026-03-10 00:00:00 PDT
    expect((await owner(http.get('/reports/cash-up?date=2026-03-09')).expect(200)).body.grandTotalCents).toBe(5);
    expect((await owner(http.get('/reports/cash-up?date=2026-03-10')).expect(200)).body.grandTotalCents).toBe(7);
    await owner(http.get('/reports/cash-up')).expect(400);
    await owner(http.get('/reports/cash-up?date=10-03-2026')).expect(400);
    await owner(http.get('/reports/cash-up?date=2026-02-31')).expect(400);
    const empty = await owner(http.get('/reports/cash-up?date=2020-01-01')).expect(200);
    expect(empty.body).toMatchObject({ byMethod: [], byUser: [], grandTotalCents: 0 });
  });
});

describe('payments, credit notes and cash-up audit', () => {
  it('writes exactly one row per action with the right patient_id and no sensitive values', async () => {
    const invoice = await issued(INVOICE_SENTINEL);
    await testDataSource.query('TRUNCATE audit_log');
    await pay(invoice.id, { method: 'cash', amountCents: PAYMENT_SENTINEL, reference: REFERENCE_SENTINEL }).expect(201);
    await credit(invoice.id, { amountCents: CREDIT_SENTINEL, reason: REASON_SENTINEL }).expect(201);
    await owner(http.get('/reports/cash-up?date=2026-03-10')).expect(200);

    const rows = await auditRows();
    expect(rows.map((r: { action: string }) => r.action)).toEqual([
      'billing.payment.create',
      'billing.credit_note.create',
      'billing.cash_up.view',
    ]);
    expect(rows[0].patient_id).toBe(patientId);
    expect(rows[1].patient_id).toBe(patientId);
    expect(rows[2].patient_id).toBeNull();
    const json = JSON.stringify(rows);
    for (const sentinel of [
      String(INVOICE_SENTINEL), String(PAYMENT_SENTINEL), String(CREDIT_SENTINEL),
      REASON_SENTINEL, REFERENCE_SENTINEL, 'CN-0', 'INV-0',
    ]) {
      expect(json).not.toContain(sentinel);
    }
  });

  it('writes no audit rows for rejected requests', async () => {
    const invoice = await issued(1000);
    await testDataSource.query('TRUNCATE audit_log');
    await pay(invoice.id, { method: 'cash', amountCents: 5000 }).expect(409);
    await credit(invoice.id, { amountCents: 5000, reason: 'x' }).expect(409);
    expect(await auditRows()).toHaveLength(0);
  });

  it('rolls back a payment and a credit note when the audit write throws', async () => {
    const invoice = await issued(1000);
    const spy = jest.spyOn(AuditService.prototype, 'record').mockRejectedValue(new Error('audit down'));
    await pay(invoice.id, { method: 'cash', amountCents: 100 }).expect(500);
    await credit(invoice.id, { amountCents: 100, reason: 'x' }).expect(500);
    await owner(http.get('/reports/cash-up?date=2026-03-10')).expect(500);
    spy.mockRestore();
    const [{ p, c }] = await testDataSource.query(
      'SELECT (SELECT count(*)::int FROM payments) AS p, (SELECT count(*)::int FROM credit_notes) AS c',
    );
    expect({ p, c }).toEqual({ p: 0, c: 0 });
    const [{ last_value: value }] = await testDataSource.query(`SELECT last_value::int FROM document_counters WHERE name = 'credit_note'`);
    expect(value).toBe(0);
  });
});

describe('payments and credit notes: response shape', () => {
  it('exposes no internal columns and uses the standard error format', async () => {
    const invoice = await issued(1000);
    const payment = await pay(invoice.id, { method: 'cash', amountCents: 100 }).expect(201);
    expect(Object.keys(payment.body).sort()).toEqual(
      ['amountCents', 'currencyCode', 'id', 'invoice', 'invoiceId', 'method', 'paidAt', 'reference'],
    );
    const note = await credit(invoice.id, { amountCents: 100, reason: 'r' }).expect(201);
    expect(Object.keys(note.body).sort()).toEqual(
      ['amountCents', 'createdAt', 'creditNoteNumber', 'currencyCode', 'id', 'invoice', 'invoiceId', 'reason'],
    );
    const json = JSON.stringify([payment.body, note.body]);
    for (const column of ['received_by', 'created_by', 'invoice_id', 'amount_cents', 'receivedBy', 'createdBy']) {
      expect(json).not.toContain(`"${column}"`);
    }
    const report = await owner(http.get('/reports/cash-up?date=2026-03-10')).expect(200);
    expect(JSON.stringify(report.body)).not.toMatch(/password|email|received_by/i);

    const conflict = await pay(invoice.id, { method: 'cash', amountCents: 5000 }).expect(409);
    expect(conflict.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    expect(Array.isArray(conflict.body.message)).toBe(true);
    const invalid = await pay(invoice.id, { method: 'insurance', amountCents: 1 }).expect(400);
    expect(invalid.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(Array.isArray(invalid.body.message)).toBe(true);
    const forbidden = await receptionist(http.post(`/invoices/${invoice.id}/credit-notes`)).send({ amountCents: 1, reason: 'x' }).expect(403);
    expect(forbidden.body).toMatchObject({ statusCode: 403 });
  });
});