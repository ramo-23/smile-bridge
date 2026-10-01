import { IsDateString, IsOptional } from 'class-validator';

export class BlockedPeriodFiltersDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}