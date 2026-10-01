import { MigrationInterface, QueryRunner } from 'typeorm';
import { runSql } from '../run-sql';

export class Messaging1700000000005 implements MigrationInterface {
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '005_messaging.up.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await runSql(queryRunner, '005_messaging.down.sql');
  }
}