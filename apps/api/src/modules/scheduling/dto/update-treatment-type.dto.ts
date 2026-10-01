import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDivisibleBy,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateTreatmentTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  procedureCode?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  @IsDivisibleBy(5)
  defaultDurationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultPriceCents?: number;

  @IsOptional()
  @IsBoolean()
  patientBookable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}