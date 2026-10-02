import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PlanStatus, ToothRecordType, ToothSurface } from '../../../database/enums';
import { ToothConditionCode } from '../clinical.enums';

export class CreateToothRecordDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32)
  toothNumber!: number;

  @IsOptional()
  @IsEnum(ToothSurface)
  surface?: ToothSurface | null;

  @IsEnum(ToothRecordType)
  recordType!: ToothRecordType;

  @IsEnum(ToothConditionCode)
  conditionCode!: ToothConditionCode;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}

export class VoidToothRecordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class CreateClinicalNoteDto {
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}

export class UpdateClinicalNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}

export class CreateTreatmentPlanItemDto {
  @IsUUID()
  treatmentTypeId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32)
  toothNumber?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  priority = 2;
}

export class CreateTreatmentPlanDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateTreatmentPlanItemDto)
  items!: CreateTreatmentPlanItemDto[];
}

export class AddTreatmentPlanItemsDto extends CreateTreatmentPlanDto {}

export class UpdateTreatmentPlanItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number;
}

export class UpdateTreatmentPlanItemStatusDto {
  @IsEnum(PlanStatus)
  status!: PlanStatus;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}