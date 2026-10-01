import { randomUUID } from 'node:crypto';
import '../../src/database/data-source';
import { DataSource } from 'typeorm';
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
import { databaseEntities } from '../../src/database/entities';
import { SnakeCaseNamingStrategy } from '../../src/database/snake-case-naming.strategy';

const testDatabase = process.env.DB_TEST_DATABASE;
const developmentDatabase = process.env.DB_DATABASE ?? 'smile_bridge';

if (!testDatabase) {
  throw new Error('DB_TEST_DATABASE is required; refusing to run database integration tests.');
}

if (
  testDatabase === developmentDatabase ||
  testDatabase === 'smile_bridge' ||
  !/(^|[_-])test($|[_-])/i.test(testDatabase)
) {
  throw new Error(
    `Refusing destructive integration tests against non-test database "${testDatabase}".`,
  );
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
  ],
  synchronize: false,
});

let fixtureNumber = 0;

type SchedulingFixture = {
  userId: string;
  patientId: string;
  providers: [string, ...string[]];
  treatmentTypeId: string;
};

function uniqueToken(): string {
  fixtureNumber += 1;
  return `${fixtureNumber}-${randomUUID()}`;
}

async function createUser(): Promise<string> {
  const token = uniqueToken();
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, 'test-hash', 'Integration Test', 'dentist_owner')
     RETURNING id`,
    [`${token}@example.invalid`],
  );
  return user.id;
}

async function createPatient(createdBy: string): Promise<string> {
  const [patient] = await testDataSource.query(
    `INSERT INTO patients (first_name, last_name, date_of_birth, phone_e164, created_by)
     VALUES ('Test', $1, '1990-01-01', '+15555550100', $2)
     RETURNING id`,
    [uniqueToken(), createdBy],
  );
  return patient.id;
}

async function createProvider(userId: string): Promise<string> {
  const [provider] = await testDataSource.query(
    `INSERT INTO providers (user_id, display_name) VALUES ($1, 'Integration Provider') RETURNING id`,
    [userId],
  );
  return provider.id;
}

async function createTreatmentType(): Promise<string> {
  const [treatmentType] = await testDataSource.query(
    `INSERT INTO treatment_types (name, default_duration_minutes, default_price_cents)
     VALUES ($1, 30, 10000) RETURNING id`,
    [`Integration ${uniqueToken()}`],
  );
  return treatmentType.id;
}

async function createSchedulingFixture(providerCount = 1): Promise<SchedulingFixture> {
  const userId = await createUser();
  const patientId = await createPatient(userId);
  const providers: [string, ...string[]] = [await createProvider(userId)];

  for (let index = 1; index < providerCount; index += 1) {
    providers.push(await createProvider(await createUser()));
  }

  return {
    userId,
    patientId,
    providers,
    treatmentTypeId: await createTreatmentType(),
  };
}

async function createAppointment(
  fixture: Awaited<ReturnType<typeof createSchedulingFixture>>,
  providerId: string,
  startsAt: string,
  endsAt: string,
  blockedUntil: string,
  status = 'scheduled',
): Promise<string> {
  const [appointment] = await testDataSource.query(
    `INSERT INTO appointments
       (patient_id, provider_id, treatment_type_id, starts_at, ends_at, blocked_until,
        status, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'staff', $8)
     RETURNING id`,
    [
      fixture.patientId,
      providerId,
      fixture.treatmentTypeId,
      startsAt,
      endsAt,
      blockedUntil,
      status,
      fixture.userId,
    ],
  );
  return appointment.id;
}

async function createInvoiceFixture(status: 'draft' | 'issued') {
  const userId = await createUser();
  const patientId = await createPatient(userId);
  const token = uniqueToken();
  const [invoice] = await testDataSource.query(
    `INSERT INTO invoices (patient_id, status, total_cents, created_by)
     VALUES ($1, 'draft', 10000, $2)
     RETURNING id`,
    [patientId, userId],
  );
  const [line] = await testDataSource.query(
    `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, 'Integration line', 1, 10000, 10000)
     RETURNING id`,
    [invoice.id],
  );

  if (status === 'issued') {
    await testDataSource.query(
      `UPDATE invoices SET invoice_number = $1, status = 'issued', issued_at = now() WHERE id = $2`,
      [`INV-${token}`, invoice.id],
    );
  }

  return { invoiceId: invoice.id, lineId: line.id };
}

async function createClinicalNoteVersion() {
  const userId = await createUser();
  const patientId = await createPatient(userId);
  const [note] = await testDataSource.query(
    `INSERT INTO clinical_notes (patient_id, created_by) VALUES ($1, $2) RETURNING id`,
    [patientId, userId],
  );
  const [version] = await testDataSource.query(
    `INSERT INTO clinical_note_versions (note_id, version_no, body, author_id)
     VALUES ($1, 1, $2, $3) RETURNING id`,
    [note.id, Buffer.from('test note'), userId],
  );
  return version.id;
}

async function createClaimStatusHistory() {
  const userId = await createUser();
  const patientId = await createPatient(userId);
  const [policy] = await testDataSource.query(
    `INSERT INTO insurance_policies
       (patient_id, insurer_name, policy_number, principal_member_name)
     VALUES ($1, 'Test insurer', $2, 'Integration Test') RETURNING id`,
    [patientId, uniqueToken()],
  );
  const [invoice] = await testDataSource.query(
    `INSERT INTO invoices (patient_id, status, total_cents, created_by)
     VALUES ($1, 'draft', 10000, $2) RETURNING id`,
    [patientId, userId],
  );
  const [claim] = await testDataSource.query(
    `INSERT INTO claims (invoice_id, insurance_policy_id, amount_claimed_cents, created_by)
     VALUES ($1, $2, 10000, $3) RETURNING id`,
    [invoice.id, policy.id, userId],
  );
  const [history] = await testDataSource.query(
    `INSERT INTO claim_status_history (claim_id, to_status, changed_by)
     VALUES ($1, 'draft', $2) RETURNING id`,
    [claim.id, userId],
  );
  return history.id;
}

beforeAll(async () => {
  await testDataSource.initialize();
  await testDataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
  await testDataSource.query('CREATE SCHEMA public');
  await testDataSource.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');

  const migrations = await testDataSource.runMigrations();
  expect(migrations).toHaveLength(12);
});

afterAll(async () => {
  if (testDataSource.isInitialized) {
    await testDataSource.destroy();
  }
});

describe('PostgreSQL schema integration', () => {
  it('rejects overlapping appointments for the same provider', async () => {
    const fixture = await createSchedulingFixture();
    const providerId = fixture.providers[0];
    await createAppointment(
      fixture,
      providerId,
      '2035-01-01T10:00:00Z',
      '2035-01-01T11:00:00Z',
      '2035-01-01T11:10:00Z',
    );

    await expect(
      createAppointment(
        fixture,
        providerId,
        '2035-01-01T10:30:00Z',
        '2035-01-01T11:30:00Z',
        '2035-01-01T11:40:00Z',
      ),
    ).rejects.toThrow(/appointments_no_overlap/);
  });

  it.each(['cancelled', 'no_show'])(
    'allows overlap when the earlier appointment is %s',
    async (status) => {
      const fixture = await createSchedulingFixture();
      const providerId = fixture.providers[0];
      await createAppointment(
        fixture,
        providerId,
        '2035-01-02T10:00:00Z',
        '2035-01-02T11:00:00Z',
        '2035-01-02T11:10:00Z',
        status,
      );

      await expect(
        createAppointment(
          fixture,
          providerId,
          '2035-01-02T10:00:00Z',
          '2035-01-02T11:00:00Z',
          '2035-01-02T11:10:00Z',
        ),
      ).resolves.toBeTruthy();
    },
  );

  it('rejects an appointment starting inside the earlier appointment buffer', async () => {
    const fixture = await createSchedulingFixture();
    const providerId = fixture.providers[0];
    await createAppointment(
      fixture,
      providerId,
      '2035-01-03T10:00:00Z',
      '2035-01-03T11:00:00Z',
      '2035-01-03T11:10:00Z',
    );

    await expect(
      createAppointment(
        fixture,
        providerId,
        '2035-01-03T11:05:00Z',
        '2035-01-03T11:35:00Z',
        '2035-01-03T11:45:00Z',
      ),
    ).rejects.toThrow(/appointments_no_overlap/);
  });

  it('allows overlapping appointments for different providers', async () => {
    const fixture = await createSchedulingFixture(2);
    await createAppointment(
      fixture,
      fixture.providers[0],
      '2035-01-04T10:00:00Z',
      '2035-01-04T11:00:00Z',
      '2035-01-04T11:10:00Z',
    );

    await expect(
      createAppointment(
        fixture,
        fixture.providers[1]!,
        '2035-01-04T10:30:00Z',
        '2035-01-04T11:30:00Z',
        '2035-01-04T11:40:00Z',
      ),
    ).resolves.toBeTruthy();
  });

  it.each([
    [
      'audit_log',
      async () => {
        const [row] = await testDataSource.query(
          `INSERT INTO audit_log (action, entity_type) VALUES ('test', 'integration') RETURNING id`,
        );
        return {
          id: row.id,
          update: `UPDATE audit_log SET action = 'edited' WHERE id = $1`,
          delete: 'DELETE FROM audit_log WHERE id = $1',
        };
      },
    ],
    ['clinical_note_versions', createClinicalNoteVersion],
    ['claim_status_history', createClaimStatusHistory],
  ])('%s rejects UPDATE and DELETE', async (table, createRow) => {
    const row = await createRow();
    const updateSql =
      typeof row === 'object' ? row.update : `UPDATE ${table} SET id = id WHERE id = $1`;
    const deleteSql = typeof row === 'object' ? row.delete : `DELETE FROM ${table} WHERE id = $1`;
    const rowId = typeof row === 'object' ? row.id : row;

    await expect(testDataSource.query(updateSql, [rowId])).rejects.toThrow(/append-only/);
    await expect(testDataSource.query(deleteSql, [rowId])).rejects.toThrow(/append-only/);
  });

  it('rejects UPDATE and DELETE on issued invoices', async () => {
    const { invoiceId } = await createInvoiceFixture('issued');

    await expect(
      testDataSource.query('UPDATE invoices SET total_cents = 20000 WHERE id = $1', [invoiceId]),
    ).rejects.toThrow(/issued invoices are immutable/);
    await expect(
      testDataSource.query('DELETE FROM invoices WHERE id = $1', [invoiceId]),
    ).rejects.toThrow(/issued invoices are immutable/);
  });

  it('rejects UPDATE and DELETE on lines of issued invoices', async () => {
    const { lineId } = await createInvoiceFixture('issued');

    await expect(
      testDataSource.query(`UPDATE invoice_lines SET description = 'Edited' WHERE id = $1`, [
        lineId,
      ]),
    ).rejects.toThrow(/lines of an issued invoice are immutable/);
    await expect(
      testDataSource.query('DELETE FROM invoice_lines WHERE id = $1', [lineId]),
    ).rejects.toThrow(/lines of an issued invoice are immutable/);
  });

  it('rejects inserting a line into an issued invoice', async () => {
    const { invoiceId } = await createInvoiceFixture('issued');

    await expect(
      testDataSource.query(
        `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_cents, line_total_cents)
         VALUES ($1, 'Late line', 1, 10000, 10000)`,
        [invoiceId],
      ),
    ).rejects.toThrow(/cannot add lines to an issued invoice/);
  });

  it('allows UPDATE and DELETE on draft invoices and their lines', async () => {
    const { invoiceId, lineId } = await createInvoiceFixture('draft');

    await expect(
      testDataSource.query('UPDATE invoices SET total_cents = 20000 WHERE id = $1', [invoiceId]),
    ).resolves.toBeDefined();
    await expect(
      testDataSource.query(`UPDATE invoice_lines SET description = 'Edited' WHERE id = $1`, [
        lineId,
      ]),
    ).resolves.toBeDefined();
    await expect(
      testDataSource.query('DELETE FROM invoice_lines WHERE id = $1', [lineId]),
    ).resolves.toBeDefined();
    await expect(
      testDataSource.query('DELETE FROM invoices WHERE id = $1', [invoiceId]),
    ).resolves.toBeDefined();
  });

  it('rejects rejected claims without a rejection reason', async () => {
    const userId = await createUser();
    const patientId = await createPatient(userId);
    const [policy] = await testDataSource.query(
      `INSERT INTO insurance_policies (patient_id, insurer_name, policy_number, principal_member_name)
       VALUES ($1, 'Test insurer', $2, 'Integration Test') RETURNING id`,
      [patientId, uniqueToken()],
    );
    const [invoice] = await testDataSource.query(
      `INSERT INTO invoices (patient_id, status, total_cents, created_by)
       VALUES ($1, 'draft', 10000, $2) RETURNING id`,
      [patientId, userId],
    );

    await expect(
      testDataSource.query(
        `INSERT INTO claims (invoice_id, insurance_policy_id, status, amount_claimed_cents, created_by)
         VALUES ($1, $2, 'rejected', 10000, $3)`,
        [invoice.id, policy.id, userId],
      ),
    ).rejects.toThrow(/claims_check/);
  });

  it('rejects paid claims without an amount paid', async () => {
    const userId = await createUser();
    const patientId = await createPatient(userId);
    const [policy] = await testDataSource.query(
      `INSERT INTO insurance_policies (patient_id, insurer_name, policy_number, principal_member_name)
       VALUES ($1, 'Test insurer', $2, 'Integration Test') RETURNING id`,
      [patientId, uniqueToken()],
    );
    const [invoice] = await testDataSource.query(
      `INSERT INTO invoices (patient_id, status, total_cents, created_by)
       VALUES ($1, 'draft', 10000, $2) RETURNING id`,
      [patientId, userId],
    );

    await expect(
      testDataSource.query(
        `INSERT INTO claims (invoice_id, insurance_policy_id, status, amount_claimed_cents, created_by)
         VALUES ($1, $2, 'paid', 10000, $3)`,
        [invoice.id, policy.id, userId],
      ),
    ).rejects.toThrow(/claims_check1/);
  });

  it('reverts all migrations to an empty schema and applies them again', async () => {
    const [before] = await testDataSource.query(
      'SELECT COUNT(*)::integer AS count FROM migrations',
    );
    expect(before.count).toBe(12);

    for (let index = 0; index < 12; index += 1) {
      await testDataSource.undoLastMigration();
    }

    const [after] = await testDataSource.query('SELECT COUNT(*)::integer AS count FROM migrations');
    const tables = await testDataSource.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'migrations'`,
    );
    const enums = await testDataSource.query(
      `SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    );
    expect(after.count).toBe(0);
    expect(tables).toHaveLength(0);
    expect(enums).toHaveLength(0);

    const reapplied = await testDataSource.runMigrations();
    expect(reapplied).toHaveLength(12);

    const [final] = await testDataSource.query('SELECT COUNT(*)::integer AS count FROM migrations');
    expect(final.count).toBe(12);
  });
});
