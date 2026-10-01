import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class Clinical1700000000006 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '006_clinical.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '006_clinical.down.sql');
  }
}