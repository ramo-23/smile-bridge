import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SeverityLevel } from '../../../database/enums';

export class CreateAllergyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  substance!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reaction?: string | null;

  @IsEnum(SeverityLevel)
  severity!: SeverityLevel;
}

export class UpdateAllergyDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  substance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reaction?: string | null;

  @IsOptional()
  @IsEnum(SeverityLevel)
  severity?: SeverityLevel;

  @IsOptional()
  @IsBoolean()
  resolved?: boolean;
}
