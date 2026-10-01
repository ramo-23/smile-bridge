import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class UpdatedAtTriggers1700000000011 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '011_updated_at_triggers.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '011_updated_at_triggers.down.sql');
  }
}