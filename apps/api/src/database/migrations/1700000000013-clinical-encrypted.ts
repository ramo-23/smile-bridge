import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class ClinicalEncrypted1700000000013 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '013_clinical_encrypted.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '013_clinical_encrypted.down.sql');
  }
}