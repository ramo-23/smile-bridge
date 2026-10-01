import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhoneNumberService } from '../../common/phone-number.service';
import { AuditService } from '../audit/audit.service';
import { UpdateClinicSettingsDto } from './dto/update-clinic-settings.dto';
import { ClinicSettingEntity } from './entities/clinic-setting.entity';

type Actor = { userId: string; ip: string | null };

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(ClinicSettingEntity)
    private readonly settings: Repository<ClinicSettingEntity>,
    private readonly phones: PhoneNumberService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ClinicSettingEntity | { configured: false }> {
    return (await this.settings.findOne({ where: { id: true } })) ?? { configured: false };
  }

  async update(dto: UpdateClinicSettingsDto, actor: Actor): Promise<ClinicSettingEntity> {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: dto.timezone });
    } catch {
      throw new BadRequestException('Invalid IANA timezone');
    }

    const values = {
      clinicName: dto.clinicName.trim(),
      address: dto.address?.trim() || null,
      phoneE164: dto.phone ? this.phones.normalize(dto.phone) : null,
      timezone: dto.timezone,
      currencyCode: dto.currencyCode,
      bufferMinutes: dto.bufferMinutes,
      reminderHoursBefore: dto.reminderHoursBefore,
    };

    return this.settings.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ClinicSettingEntity);
      const current = await repository.findOne({ where: { id: true } });
      const setting = repository.create({ ...current, id: true, ...values, updatedAt: new Date() });
      const saved = await repository.save(setting);
      const changedFields = (Object.keys(values) as Array<keyof typeof values>).filter(
        (field) => current?.[field] !== values[field],
      );
      await this.audit.record(
        {
          userId: actor.userId,
          action: 'settings.update',
          entityType: 'clinic_settings',
          entityId: null,
          patientId: null,
          ip: actor.ip,
          metadata: { changedFields },
        },
        manager,
      );
      return saved;
    });
  }
}
