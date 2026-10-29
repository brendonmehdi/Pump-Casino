import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/\S+$/, 'DATABASE_URL must be a postgres:// connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Defaults to true in production. Browsers only send Secure cookies over HTTPS. */
  COOKIE_SECURE: flag.optional(),
  /** Set to true behind a reverse proxy (Railway) so request.ip is the client address. */
  TRUST_PROXY: flag.default(false),
  /** Extra origins allowed to send mutating requests, comma-separated (same-origin is always allowed). */
  ALLOWED_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  SESSIONS_PER_HOUR_PER_IP: z.coerce.number().int().min(1).default(60),
  /** Built web app to serve on the same origin; unset in development (Vite serves it). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly allowedOrigins: readonly string[];
  readonly logLevel: string;
  readonly rateLimitPerMinute: number;
  readonly sessionsPerHourPerIp: number;
  readonly webDistDir: string | null;
  readonly version: string;
}

/** Validates the environment once at startup; any problem stops the process with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    logLevel: e.LOG_LEVEL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    sessionsPerHourPerIp: e.SESSIONS_PER_HOUR_PER_IP,
    webDistDir: e.WEB_DIST_DIR ?? null,
    version: e.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
