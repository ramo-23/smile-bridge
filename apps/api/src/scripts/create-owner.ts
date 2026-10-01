import * as argon2 from 'argon2';
import { AppDataSource } from '../database/data-source';
import { UserRole } from '../database/enums';
import { UserEntity } from '../modules/users/entities/user.entity';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function createOwner(): Promise<void> {
  const fullName = argument('name') ?? process.env.BOOTSTRAP_OWNER_NAME;
  const email = argument('email') ?? process.env.BOOTSTRAP_OWNER_EMAIL;
  const password = argument('password') ?? process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!fullName || !email || !password || password.length < 12) {
    throw new Error(
      'Provide --name, --email, and a password of at least 12 characters (or matching BOOTSTRAP_OWNER_* variables).',
    );
  }

  await AppDataSource.initialize();
  try {
    const user = await AppDataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [734821]);
      const existing = await manager.query('SELECT id FROM users LIMIT 1');
      if (existing.length > 0)
        throw new Error('Owner bootstrap refused: the database already contains a user.');

      const created = await manager.getRepository(UserEntity).save({
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        fullName,
        role: UserRole.DentistOwner,
        isActive: true,
      });
      await manager.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'user.create', 'user', $1, $2::jsonb)`,
        [created.id, JSON.stringify({ role: UserRole.DentistOwner })],
      );
      return created;
    });
    console.log(`Created dentist owner ${user.email} (${user.id}).`);
  } finally {
    await AppDataSource.destroy();
  }
}

void createOwner().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner bootstrap failed.');
  process.exitCode = 1;
});
