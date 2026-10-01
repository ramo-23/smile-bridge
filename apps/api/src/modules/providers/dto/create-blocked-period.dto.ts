import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const ISO_DATE_TIME_WITH_OFFSET = /(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;

export class CreateBlockedPeriodDto {
  @IsDateString({ strict: true })
  @Matches(ISO_DATE_TIME_WITH_OFFSET)
  startsAt!: string;

  @IsDateString({ strict: true })
  @Matches(ISO_DATE_TIME_WITH_OFFSET)
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}