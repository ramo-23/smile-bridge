import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class DocumentCounters1700000000014 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '014_document_counters.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '014_document_counters.down.sql');
  }
}
