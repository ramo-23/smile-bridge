import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateClinicSettingsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  clinicName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timezone!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  bufferMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  reminderHoursBefore!: number;
}