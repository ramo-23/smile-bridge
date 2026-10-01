import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BlockedPeriodEntity } from '../scheduling/entities/blocked-period.entity';
import { WorkingHourEntity } from '../scheduling/entities/working-hour.entity';
import { UserEntity } from '../users/entities/user.entity';
import { ProviderEntity } from './entities/provider.entity';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([ProviderEntity, WorkingHourEntity, BlockedPeriodEntity, UserEntity]),
		AuditModule,
	],
	controllers: [ProvidersController],
	providers: [ProvidersService],
})
export class ProvidersModule {}
