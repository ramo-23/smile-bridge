import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import '../../src/database/data-source';
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
import { databaseEntities } from '../../src/database/entities';
import { SnakeCaseNamingStrategy } from '../../src/database/snake-case-naming.strategy';
import { AuditService } from '../../src/modules/audit/audit.service';
import { UserRole } from '../../src/database/enums';

const testDatabase = process.env.DB_TEST_DATABASE;
const developmentDatabase = process.env.DB_DATABASE ?? 'smile_bridge';
if (!testDatabase)
  throw new Error('DB_TEST_DATABASE is required; refusing to run database integration tests.');
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
    ClinicalEncrypted1700000000013,
  ],
  synchronize: false,
});

const fixturePassword = 'correct horse battery staple';
let app: INestApplication;
let http: supertest.Agent;
let fixtureNumber = 0;

function email(): string {
  fixtureNumber += 1;
  return `${fixtureNumber}-${randomUUID()}@example.invalid`;
}

async function createUser(
  role: UserRole = UserRole.DentistOwner,
  options: { active?: boolean; password?: string; email?: string } = {},
): Promise<{ id: string; email: string }> {
  const userEmail = options.email ?? email();
  const hash = await argon2.hash(options.password ?? fixturePassword, { type: argon2.argon2id });
  const [user] = await testDataSource.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, 'Integration User', $3, $4) RETURNING id, email`,
    [userEmail, hash, role, options.active ?? true],
  );
  return user;
}

function login(userEmail: string, password = fixturePassword): supertest.Test {
  return http
    .post('/auth/login')
    .set('X-Requested-With', 'smile-bridge')
    .send({ email: userEmail, password });
}

function cookieFrom(response: supertest.Response): string {
  const value = response.headers['set-cookie']?.[0];
  if (!value) throw new Error('Login response did not set a session cookie');
  return value.split(';')[0]!;
}

function withSession(cookie: string) {
  return (test: supertest.Test) =>
    test.set('Cookie', cookie).set('X-Requested-With', 'smile-bridge');
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
  process.env.SESSION_IDLE_MINUTES = '30';
  process.env.SESSION_ABSOLUTE_HOURS = '12';

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
  http = supertest(app.getHttpServer());
  await testDataSource.query('TRUNCATE sessions, audit_log, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  if (app) await app.close();
  if (testDataSource.isInitialized) await testDataSource.destroy();
});

describe('authentication, authorization, and audit', () => {
  it('logs in, sets a strict httpOnly cookie, serves me, and logout revokes the session', async () => {
    const user = await createUser();
    const response = await login(user.email);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: user.id, name: 'Integration User', role: 'dentist_owner' });
    const setCookie = response.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).not.toMatch(/; Secure/i);

    const cookie = cookieFrom(response);
    const token = decodeURIComponent(cookie.slice('smile_bridge_session='.length));
    const { createHash } = await import('node:crypto');
    const [storedSession] = await testDataSource.query(
      'SELECT token_hash FROM sessions WHERE user_id = $1',
      [user.id],
    );
    expect(storedSession.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    await withSession(cookie)(http.get('/auth/me')).expect(200, {
      id: user.id,
      name: 'Integration User',
      role: 'dentist_owner',
    });
    const [session] = await testDataSource.query(
      'SELECT id, revoked_at FROM sessions WHERE user_id = $1',
      [user.id],
    );
    await withSession(cookie)(http.post('/auth/logout')).expect(201, { success: true });
    const [revoked] = await testDataSource.query('SELECT revoked_at FROM sessions WHERE id = $1', [
      session.id,
    ]);
    expect(revoked.revoked_at).toBeTruthy();
    await http.get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('returns identical login errors for wrong, unknown, inactive, and locked accounts', async () => {
    const wrong = await createUser();
    const inactive = await createUser(UserRole.DentistOwner, { active: false });
    const locked = await createUser();
    await testDataSource.query(
      "UPDATE users SET locked_until = now() + interval '15 minutes' WHERE id = $1",
      [locked.id],
    );

    const responses = await Promise.all([
      login(wrong.email, 'wrong password'),
      login(email()),
      login(inactive.email),
      login(locked.email),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid email or password');
    }
  });

  it('locks after five failures and accepts the correct password only after lock expiry', async () => {
    const user = await createUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(user.email, 'incorrect password').expect(401);
    }
    const [locked] = await testDataSource.query(
      'SELECT failed_login_count, locked_until FROM users WHERE id = $1',
      [user.id],
    );
    expect(locked.failed_login_count).toBe(5);
    expect(new Date(locked.locked_until).getTime()).toBeGreaterThan(Date.now());
    await login(user.email).expect(401);
    await testDataSource.query(
      "UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1",
      [user.id],
    );
    await login(user.email).expect(201);
  });

  it('rejects sessions idle past 30 minutes and sessions past their absolute expiry', async () => {
    const user = await createUser();
    const idleCookie = cookieFrom(await login(user.email));
    const [, idleToken] = idleCookie.split('=');
    const { createHash } = await import('node:crypto');
    const idleHash = createHash('sha256').update(decodeURIComponent(idleToken!)).digest('hex');
    await testDataSource.query(
      "UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE token_hash = $1",
      [idleHash],
    );
    await http.get('/auth/me').set('Cookie', idleCookie).expect(401);

    const absoluteCookie = cookieFrom(await login(user.email));
    const [, absoluteToken] = absoluteCookie.split('=');
    const absoluteHash = createHash('sha256')
      .update(decodeURIComponent(absoluteToken!))
      .digest('hex');
    await testDataSource.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [absoluteHash],
    );
    await http.get('/auth/me').set('Cookie', absoluteCookie).expect(401);
  });

  it('requires authentication and enforces dentist-owner routes', async () => {
    await http.get('/users').expect(401);
    const receptionist = await createUser(UserRole.Receptionist);
    const cookie = cookieFrom(await login(receptionist.email));
    await withSession(cookie)(http.get('/users')).expect(403);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const owner = await createUser();
    const cookie = cookieFrom(await login(owner.email));
    await http
      .post('/users')
      .set('Cookie', cookie)
      .send({
        email: email(),
        name: 'No CSRF',
        role: UserRole.Receptionist,
        password: fixturePassword,
      })
      .expect(403);
  });

  it('revokes a deactivated user session immediately', async () => {
    const owner = await createUser();
    const staff = await createUser(UserRole.Receptionist);
    const ownerCookie = cookieFrom(await login(owner.email));
    const staffCookie = cookieFrom(await login(staff.email));
    await withSession(ownerCookie)(
      http.patch(`/users/${staff.id}`).send({ isActive: false }),
    ).expect(200);
    await http.get('/auth/me').set('Cookie', staffCookie).expect(401);
  });

  it('prevents demoting/deactivating oneself and removing the last active owner', async () => {
    const owner = await createUser();
    const secondOwner = await createUser();
    const cookie = cookieFrom(await login(owner.email));
    await withSession(cookie)(
      http.patch(`/users/${owner.id}`).send({ role: UserRole.Receptionist }),
    ).expect(400);
    await withSession(cookie)(http.patch(`/users/${owner.id}`).send({ isActive: false })).expect(
      400,
    );
    const secondCookie = cookieFrom(await login(secondOwner.email));
    await withSession(secondCookie)(
      http.patch(`/users/${owner.id}`).send({ role: UserRole.Receptionist }),
    ).expect(200);
    const [remainingOwners] = await testDataSource.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'dentist_owner' AND is_active",
    );
    expect(remainingOwners.count).toBe(1);
    await withSession(secondCookie)(
      http.patch(`/users/${secondOwner.id}`).send({ role: UserRole.Receptionist }),
    ).expect(400);
    await withSession(secondCookie)(
      http.patch(`/users/${secondOwner.id}`).send({ isActive: false }),
    ).expect(400);
  });

  it('serializes simultaneous owner demotions and preserves an active owner', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const firstOwner = await createUser();
      const secondOwner = await createUser();
      const firstCookie = cookieFrom(await login(firstOwner.email));
      const secondCookie = cookieFrom(await login(secondOwner.email));

      const responses = await Promise.all([
        withSession(firstCookie)(
          http.patch(`/users/${secondOwner.id}`).send({ role: UserRole.Receptionist }),
        ),
        withSession(secondCookie)(
          http.patch(`/users/${firstOwner.id}`).send({ role: UserRole.Receptionist }),
        ),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      const [owners] = await testDataSource.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'dentist_owner' AND is_active",
      );
      expect(owners.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('writes exactly one audit row for each audited auth and user action without secrets', async () => {
    const owner = await createUser();
    const ownerCookie = cookieFrom(await login(owner.email));
    const ownerToken = decodeURIComponent(ownerCookie.slice('smile_bridge_session='.length));
    await login(owner.email, 'wrong password').expect(401);
    const lockoutTarget = await createUser(UserRole.Receptionist);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(lockoutTarget.email, 'wrong password').expect(401);
    }
    const staffEmail = email();
    const created = await withSession(ownerCookie)(
      http.post('/users').send({
        email: staffEmail,
        name: 'Created User',
        role: UserRole.Receptionist,
        password: fixturePassword,
      }),
    ).expect(201);
    const staffId = created.body.id as string;
    await withSession(ownerCookie)(
      http.patch(`/users/${staffId}`).send({ role: UserRole.DentistOwner }),
    ).expect(200);
    await withSession(ownerCookie)(
      http.patch(`/users/${staffId}`).send({ isActive: false }),
    ).expect(200);
    await withSession(ownerCookie)(http.patch(`/users/${staffId}`).send({ isActive: true })).expect(
      200,
    );
    await withSession(ownerCookie)(
      http.post(`/users/${staffId}/reset-password`).send({ password: 'updated password 123' }),
    ).expect(201);
    await withSession(ownerCookie)(http.post('/auth/logout')).expect(201);

    const expectedActions: Array<[string, number]> = [
      ['auth.login.success', 1],
      ['auth.login.failure', 6],
      ['auth.account.lockout', 1],
      ['auth.logout', 1],
      ['user.create', 1],
      ['user.role_change', 1],
      ['user.deactivate', 1],
      ['user.reactivate', 1],
      ['user.password_reset', 1],
    ];
    for (const [action, expectedCount] of expectedActions) {
      const [row] = await testDataSource.query(
        'SELECT COUNT(*)::int AS count FROM audit_log WHERE action = $1',
        [action],
      );
      expect(row.count).toBe(expectedCount);
    }
    const rows = await testDataSource.query(
      'SELECT to_jsonb(audit_log)::text AS row_data FROM audit_log',
    );
    for (const row of rows) {
      expect(row.row_data).not.toContain(fixturePassword);
      expect(row.row_data).not.toContain('wrong password');
      expect(row.row_data).not.toContain('updated password 123');
      expect(row.row_data).not.toContain(ownerToken);
      expect(row.row_data).not.toContain('@example.invalid');
    }
  });

  it('rolls back an audited operation when AuditService fails', async () => {
    const owner = await createUser();
    const cookie = cookieFrom(await login(owner.email));
    const audit = app.get(AuditService);
    const spy = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    const newEmail = email();
    await withSession(cookie)(
      http.post('/users').send({
        email: newEmail,
        name: 'Should Roll Back',
        role: UserRole.Receptionist,
        password: fixturePassword,
      }),
    ).expect(500);
    spy.mockRestore();
    const [users] = await testDataSource.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
      [newEmail],
    );
    const [audits] = await testDataSource.query(
      "SELECT COUNT(*)::int AS count FROM audit_log WHERE action = 'user.create'",
    );
    expect(users.count).toBe(0);
    expect(audits.count).toBe(0);
  });
});
