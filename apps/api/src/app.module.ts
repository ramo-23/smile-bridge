import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import './database/postgres-date-parser';
import { databaseEntities } from './database/entities';
import { SnakeCaseNamingStrategy } from './database/snake-case-naming.strategy';
import { validateEnvironment } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { BookingRequestsModule } from './modules/booking-requests/booking-requests.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { FilesModule } from './modules/files/files.module';
import { HealthController } from './modules/health/health.controller';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, '../.env'), resolve(__dirname, '../../../.env')],
      validate: (environment: Record<string, unknown>) => validateEnvironment(environment),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_DATABASE'),
        entities: databaseEntities,
        autoLoadEntities: true,
        namingStrategy: new SnakeCaseNamingStrategy(),
        synchronize: false,
      }),
    }),
    AuthModule,
    UsersModule,
    PatientsModule,
    ProvidersModule,
    SchedulingModule,
    BookingRequestsModule,
    MessagingModule,
    ClinicalModule,
    FilesModule,
    BillingModule,
    ClaimsModule,
    AuditModule,
    SettingsModule,
    HealthModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
