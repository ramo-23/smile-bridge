import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EncryptionService } from '../../common/encryption.service';
import { PhoneNumberService } from '../../common/phone-number.service';
import { AllergyEntity } from './entities/allergy.entity';
import { InsurancePolicyEntity } from './entities/insurance-policy.entity';
import { MedicalHistoryEntity } from './entities/medical-history.entity';
import { NextOfKinEntity } from './entities/next-of-kin.entity';
import { PatientEntity } from './entities/patient.entity';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatientEntity,
      NextOfKinEntity,
      AllergyEntity,
      InsurancePolicyEntity,
      MedicalHistoryEntity,
    ]),
    AuditModule,
  ],
  controllers: [PatientsController],
  providers: [PatientsService, EncryptionService, PhoneNumberService],
  exports: [PatientsService, EncryptionService],
})
export class PatientsModule {}
