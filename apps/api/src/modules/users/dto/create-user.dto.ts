import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../../../database/enums';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  password!: string;
}
