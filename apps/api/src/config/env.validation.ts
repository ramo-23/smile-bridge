import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { isSupportedCountry } from 'libphonenumber-js';

class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT = 3000;

  @IsString()
  CORS_ORIGIN = 'http://localhost:5173';

  @IsString()
  @Matches(/^[A-Z]{2}$/)
  DEFAULT_PHONE_REGION!: string;

  @IsDefined()
  @IsString()
  @IsBase64()
  ENCRYPTION_KEY!: string;

  @IsString()
  DB_HOST = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT = 5433;

  @IsString()
  DB_USERNAME = 'postgres';

  @IsString()
  DB_PASSWORD = 'postgres';

  @IsString()
  DB_DATABASE = 'smile_bridge';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  SESSION_IDLE_MINUTES = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  SESSION_ABSOLUTE_HOURS = 12;

  @Transform(({ value }) => (value === undefined ? true : value === true || value === 'true'))
  @IsBoolean()
  AUTH_COOKIE_SECURE = true;
}

export function validateEnvironment(environment: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, environment, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      errors.map((error) => Object.values(error.constraints ?? {}).join(', ')).join('; '),
    );
  }

  if (!isSupportedCountry(validated.DEFAULT_PHONE_REGION)) {
    throw new Error('DEFAULT_PHONE_REGION must be a supported ISO 3166-1 alpha-2 country code');
  }

  const encryptionKey = Buffer.from(validated.ENCRYPTION_KEY, 'base64');
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString('base64') !== validated.ENCRYPTION_KEY
  ) {
    throw new Error('ENCRYPTION_KEY must be canonical base64 encoding of exactly 32 bytes');
  }

  return validated;
}
