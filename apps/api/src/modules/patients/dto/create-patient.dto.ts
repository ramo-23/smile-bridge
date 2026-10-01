import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sex?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  guardianName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  guardianPhone?: string;

  @IsOptional()
  @IsBoolean()
  doNotMessage?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmNotDuplicate?: boolean;
}
