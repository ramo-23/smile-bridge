import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class Sessions1700000000012 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '012_sessions.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '012_sessions.down.sql');
  }
}
