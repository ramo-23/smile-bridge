import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class IdentityStaff1700000000002 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '002_identity_staff.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '002_identity_staff.down.sql');
  }
}