import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMedicalHistoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  conditions?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  medications?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string | null;
}
