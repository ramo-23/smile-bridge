import { Transform, Type, plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Max, Min, validateSync } from 'class-validator';

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

  return validated;
}
