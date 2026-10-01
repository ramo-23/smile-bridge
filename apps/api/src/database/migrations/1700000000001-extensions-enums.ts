import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class ExtensionsEnums1700000000001 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '001_extensions_enums.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '001_extensions_enums.down.sql');
  }
}