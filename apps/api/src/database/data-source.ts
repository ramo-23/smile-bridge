import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseEntities } from './entities';
import { SnakeCaseNamingStrategy } from './snake-case-naming.strategy';

config({ path: resolve(__dirname, '../../.env') });
config({ path: resolve(__dirname, '../../../../.env') });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'smile_bridge',
  entities: databaseEntities,
  migrations: ['src/database/migrations/17*{.ts,.js}'],
  migrationsTransactionMode: 'each',
  namingStrategy: new SnakeCaseNamingStrategy(),
  synchronize: false,
});
