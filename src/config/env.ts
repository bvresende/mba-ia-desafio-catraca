function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value for environment variable ${name}: ${raw}`);
  }
  return parsed;
}

function parseStringEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  return raw;
}

export interface AppEnv {
  readonly PORT: number;
  readonly HOST: string;
  readonly DATABASE_URL: string;
  readonly PARTNER_API_KEY: string;
  readonly SESSION_COOKIE_NAME: string;
  readonly SESSION_TTL_HOURS: number;
  readonly GATEWAY_FAST_MIN_MS: number;
  readonly GATEWAY_FAST_MAX_MS: number;
  readonly GATEWAY_SLOW_MIN_MS: number;
  readonly GATEWAY_SLOW_MAX_MS: number;
}

export function getEnv(): AppEnv {
  return {
    PORT: parseIntEnv('PORT', 3000),
    HOST: parseStringEnv('HOST', '0.0.0.0'),
    DATABASE_URL: parseStringEnv(
      'DATABASE_URL',
      'postgres://catraca:catraca@db:5432/catraca',
    ),
    PARTNER_API_KEY: parseStringEnv(
      'PARTNER_API_KEY',
      'catraca-partner-dev-key-2026',
    ),
    SESSION_COOKIE_NAME: parseStringEnv('SESSION_COOKIE_NAME', 'catraca_session'),
    SESSION_TTL_HOURS: parseIntEnv('SESSION_TTL_HOURS', 24),
    GATEWAY_FAST_MIN_MS: parseIntEnv('GATEWAY_FAST_MIN_MS', 2000),
    GATEWAY_FAST_MAX_MS: parseIntEnv('GATEWAY_FAST_MAX_MS', 5000),
    GATEWAY_SLOW_MIN_MS: parseIntEnv('GATEWAY_SLOW_MIN_MS', 30000),
    GATEWAY_SLOW_MAX_MS: parseIntEnv('GATEWAY_SLOW_MAX_MS', 40000),
  };
}

export const env: AppEnv = {
  get PORT() {
    return parseIntEnv('PORT', 3000);
  },
  get HOST() {
    return parseStringEnv('HOST', '0.0.0.0');
  },
  get DATABASE_URL() {
    return parseStringEnv(
      'DATABASE_URL',
      'postgres://catraca:catraca@db:5432/catraca',
    );
  },
  get PARTNER_API_KEY() {
    return parseStringEnv('PARTNER_API_KEY', 'catraca-partner-dev-key-2026');
  },
  get SESSION_COOKIE_NAME() {
    return parseStringEnv('SESSION_COOKIE_NAME', 'catraca_session');
  },
  get SESSION_TTL_HOURS() {
    return parseIntEnv('SESSION_TTL_HOURS', 24);
  },
  get GATEWAY_FAST_MIN_MS() {
    return parseIntEnv('GATEWAY_FAST_MIN_MS', 2000);
  },
  get GATEWAY_FAST_MAX_MS() {
    return parseIntEnv('GATEWAY_FAST_MAX_MS', 5000);
  },
  get GATEWAY_SLOW_MIN_MS() {
    return parseIntEnv('GATEWAY_SLOW_MIN_MS', 30000);
  },
  get GATEWAY_SLOW_MAX_MS() {
    return parseIntEnv('GATEWAY_SLOW_MAX_MS', 40000);
  },
};
