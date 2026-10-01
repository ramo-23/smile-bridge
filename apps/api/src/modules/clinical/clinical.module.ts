import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptionService } from '../../common/encryption.service';
import { AuditModule } from '../audit/audit.module';
import { PatientEntity } from '../patients/entities/patient.entity';
import { AppointmentEntity } from '../scheduling/entities/appointment.entity';
import { TreatmentTypeEntity } from '../scheduling/entities/treatment-type.entity';
import { ToothRecordEntity } from './entities/tooth-record.entity';
import { ClinicalNoteEntity } from './entities/clinical-note.entity';
import { ClinicalNoteVersionEntity } from './entities/clinical-note-version.entity';
import { TreatmentPlanItemEntity } from './entities/treatment-plan-item.entity';
import { TreatmentPlanEntity } from './entities/treatment-plan.entity';
import { ClinicalController } from './clinical.controller';
import { ClinicalService } from './clinical.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			PatientEntity,
			AppointmentEntity,
			TreatmentTypeEntity,
			ToothRecordEntity,
			ClinicalNoteEntity,
			ClinicalNoteVersionEntity,
			TreatmentPlanEntity,
			TreatmentPlanItemEntity,
		]),
		AuditModule,
	],
	controllers: [ClinicalController],
	providers: [ClinicalService, EncryptionService],
})
export class ClinicalModule {}
