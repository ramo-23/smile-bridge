import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhoneNumberService } from '../../common/phone-number.service';
import { AuditModule } from '../audit/audit.module';
import { ClinicSettingEntity } from './entities/clinic-setting.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
	imports: [TypeOrmModule.forFeature([ClinicSettingEntity]), AuditModule],
	controllers: [SettingsController],
	providers: [SettingsService, PhoneNumberService],
})
export class SettingsModule {}
