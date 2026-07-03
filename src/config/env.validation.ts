import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

const MIN_SECRET_LENGTH = 16;

/**
 * Boot-time schema for the environment. Only the values that would let the app
 * come up in an insecure or non-functional state are enforced here — secrets
 * with no safe default, and the database URL. Feature-specific configuration
 * (OAuth, payment providers, per-provider email keys) is validated where it is
 * consumed, so a deployment that doesn't use a given feature isn't forced to
 * set its variables.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH, {
    message: `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
  })
  JWT_SECRET!: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH, {
    message: `JWT_REFRESH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
  })
  JWT_REFRESH_SECRET!: string;

  @Matches(/^[a-fA-F0-9]{64}$/, {
    message: 'ENCRYPTION_KEY must be a 64-character hex string',
  })
  ENCRYPTION_KEY!: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH, {
    message: `COOKIE_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
  })
  COOKIE_SECRET!: string;

  @IsString()
  @MinLength(1, { message: 'DATABASE_URL is required' })
  DATABASE_URL!: string;
}

/**
 * `validate` hook for `ConfigModule.forRoot`. Throws (aborting boot) if any
 * required variable is missing or malformed. Returns the original config
 * untouched so every other variable is passed through exactly as before.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const candidate = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(candidate, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return config;
}
