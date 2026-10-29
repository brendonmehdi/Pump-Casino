import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Which proxies to believe about the client address, as a comma-separated list of proxy IPs,
 * CIDRs or proxy-addr keywords (`loopback`, `linklocal`, `uniquelocal`), or `false`.
 * X-Forwarded-For is then read from the right, so entries a client adds itself are ignored.
 * `true` (trust everyone) would let a client choose its own rate-limit key, and Fastify 5
 * deliberately trusts nothing for a bare hop count, so both are refused.
 */
const trustProxy = z
  .string()
  .default('false')
  .refine((value) => value !== 'true' && !/^[0-9]+$/.test(value), {
    message: 'TRUST_PROXY must be false or the addresses of trusted proxies (e.g. uniquelocal)',
  })
  .transform((value): false | string[] =>
    value === 'false' || value === ''
      ? false
      : value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
  );

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
  /** Railway: the private addresses its edge proxy connects from (see SETUP_REQUIRED.md). */
  TRUST_PROXY: trustProxy,
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
  readonly trustProxy: false | string[];
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
    logLevel: e.LOG_LEVEL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    sessionsPerHourPerIp: e.SESSIONS_PER_HOUR_PER_IP,
    webDistDir: e.WEB_DIST_DIR ?? null,
    version: e.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
