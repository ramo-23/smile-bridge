import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhoneNumberService } from '../../common/phone-number.service';
import { AuditService } from '../audit/audit.service';
import { UpdateClinicSettingsDto } from './dto/update-clinic-settings.dto';
import { ClinicSettingEntity } from './entities/clinic-setting.entity';

type Actor = { userId: string; ip: string | null };

export type ClinicSettingsResponse = {
  clinicName: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  currencyCode: string;
  bufferMinutes: number;
  reminderHoursBefore: number;
  updatedAt: Date;
};

const AUDIT_FIELD_NAMES = {
  clinicName: 'clinicName',
  address: 'address',
  phoneE164: 'phone',
  timezone: 'timezone',
  currencyCode: 'currencyCode',
  bufferMinutes: 'bufferMinutes',
  reminderHoursBefore: 'reminderHoursBefore',
} as const;

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(ClinicSettingEntity)
    private readonly settings: Repository<ClinicSettingEntity>,
    private readonly phones: PhoneNumberService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ClinicSettingsResponse | { configured: false }> {
    const setting = await this.settings.findOne({ where: { id: true } });
    return setting ? this.toResponse(setting) : { configured: false };
  }

  async update(dto: UpdateClinicSettingsDto, actor: Actor): Promise<ClinicSettingsResponse> {
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
      const changedFields = (Object.keys(values) as Array<keyof typeof values>)
        .filter((field) => current?.[field] !== values[field])
        .map((field) => AUDIT_FIELD_NAMES[field]);
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
      return this.toResponse(saved);
    });
  }

  private toResponse(setting: ClinicSettingEntity): ClinicSettingsResponse {
    return {
      clinicName: setting.clinicName,
      address: setting.address,
      phone: setting.phoneE164,
      timezone: setting.timezone,
      currencyCode: setting.currencyCode,
      bufferMinutes: setting.bufferMinutes,
      reminderHoursBefore: setting.reminderHoursBefore,
      updatedAt: setting.updatedAt,
    };
  }
}

