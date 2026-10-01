import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInsuranceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  insurerName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  policyNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  principalMemberName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  planName?: string | null;
}

export class UpdateInsuranceDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  insurerName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  policyNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  principalMemberName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  planName?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
