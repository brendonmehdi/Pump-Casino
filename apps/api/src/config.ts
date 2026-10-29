import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, checked 2026-10-29).
 * Render puts Cloudflare in front of every service, so the hop before Render's own proxies is a
 * Cloudflare address; trusting these lets the server read the visitor address Cloudflare
 * appended. A range Cloudflare adds later only makes requests through it count against the
 * Cloudflare address instead: stricter, never spoofable.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Which proxies to believe about the client address, as a comma-separated list of proxy IPs,
 * CIDRs, proxy-addr keywords (`loopback`, `linklocal`, `uniquelocal`) and `cloudflare`, or
 * `false`. X-Forwarded-For is then read from the right, so entries a client adds itself are
 * ignored. `true` (trust everyone) would let a client choose its own rate-limit key, and
 * Fastify 5 deliberately trusts nothing for a bare hop count, so both are refused.
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
          .filter((entry) => entry.length > 0)
          .flatMap((entry) => (entry === 'cloudflare' ? CLOUDFLARE_RANGES : [entry])),
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
  /** On Render: `loopback,uniquelocal,cloudflare` (see docs/DEPLOYMENT.md). */
  TRUST_PROXY: trustProxy,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  SESSIONS_PER_HOUR_PER_IP: z.coerce.number().int().min(1).default(60),
  /** Built web app to serve on the same origin; unset in development (Vite serves it). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** Set by Render for deploys from Git; reported by /api/health. */
  RENDER_GIT_COMMIT: z.string().optional(),
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
    version: e.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
  };
}
