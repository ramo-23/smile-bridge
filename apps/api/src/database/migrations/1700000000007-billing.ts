import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class Billing1700000000007 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '007_billing.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '007_billing.down.sql');
  }
}