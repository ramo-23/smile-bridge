import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateProviderDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;
}