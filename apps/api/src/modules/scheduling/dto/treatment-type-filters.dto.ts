import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

const parseBoolean = ({ value }: { value: unknown }): boolean => value === true || value === 'true';

export class TreatmentTypeFiltersDto {
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  patientBookable?: boolean;
}