import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class Claims1700000000008 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '008_claims.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '008_claims.down.sql');
  }
}