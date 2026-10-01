import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppointmentStatus } from '../../../database/enums';

const OFFSET_TIMESTAMP = /(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;

export class CreateAppointmentDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  providerId!: string;

  @IsUUID()
  treatmentTypeId!: string;

  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  startsAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  durationOverrideReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  startsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  durationOverrideReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class ChangeAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export class AppointmentCalendarQueryDto {
  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  from!: string;

  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  to!: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}

export class AvailableSlotsQueryDto {
  @IsUUID()
  providerId!: string;

  @IsUUID()
  treatmentTypeId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMinutes?: number;
}

export class NextAvailableQueryDto {
  @IsUUID()
  treatmentTypeId!: string;

  @IsUUID()
  providerId!: string;

  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  from!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  count = 3;
}

export class WalkInAppointmentDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  treatmentTypeId!: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(OFFSET_TIMESTAMP)
  startsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  durationOverrideReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}