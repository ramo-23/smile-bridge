import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PatientEntity } from '../patients/entities/patient.entity';
import { ProviderEntity } from '../providers/entities/provider.entity';
import { ClinicSettingEntity } from '../settings/entities/clinic-setting.entity';
import { AppointmentEntity } from './entities/appointment.entity';
import { BlockedPeriodEntity } from './entities/blocked-period.entity';
import { TreatmentTypeEntity } from './entities/treatment-type.entity';
import { WorkingHourEntity } from './entities/working-hour.entity';
import { AppointmentSchedulerService } from './appointment-scheduler.service';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityController } from './availability.controller';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			AppointmentEntity,
			PatientEntity,
			ProviderEntity,
			TreatmentTypeEntity,
			WorkingHourEntity,
			BlockedPeriodEntity,
			ClinicSettingEntity,
		]),
		AuditModule,
	],
	controllers: [SchedulingController, AppointmentsController, AvailabilityController],
	providers: [SchedulingService, AppointmentSchedulerService],
})
export class SchedulingModule {}
