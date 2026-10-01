import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class SettingsAudit1700000000009 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '009_settings_audit.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '009_settings_audit.down.sql');
  }
}