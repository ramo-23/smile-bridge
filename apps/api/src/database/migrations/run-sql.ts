import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryRunner } from 'typeorm';

export async function runSql(queryRunner: QueryRunner, fileName: string): Promise<void> {
  const sql = readFileSync(resolve(__dirname, '../sql', fileName), 'utf8');
  if (sql.trim()) {
    await queryRunner.query(sql);
  }
}