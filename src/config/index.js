import { z } from 'zod';
import { NODE_ENV, loadedEnvFiles } from './env.js';

const booleanish = (defaultValue) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue)
    .transform((v) => v === 'true' || v === '1');

const csv = (defaultValue) =>
  z
    .string()
    .default(defaultValue)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  APP_NAME: z.string().default('main-sv'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('/api/v1'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanish('false'),

  CORS_ORIGINS: csv('*'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  // Per IP, per RATE_LIMIT_WINDOW_MS, on login and register only: those are
  // what a password-guessing script hammers.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Unset: the app still boots and /health* works, but DB-backed routes answer 503.
  DATABASE_URL: z.string().optional(),
  /**
   * Migrations, pg_dump and anything needing session state must bypass the
   * pooler: PgBouncer in transaction mode (Neon, Supabase, RDS Proxy) rejects
   * SET, temp tables and advisory locks held across statements. Falls back to
   * DATABASE_URL for a plain Postgres with no pooler in front.
   */
  DATABASE_URL_UNPOOLED: z.string().optional(),
  // One instance on a small plan does not need a wide pool; the pooler upstream
  // is what fans out. Too many idle connections is how a free tier runs out.
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(5),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  REDIS_URL: z.string().optional(),

  // Listing photos go to Supabase Storage. Unset: the app runs, and only the
  // image upload endpoints answer 503. The service-role key bypasses storage
  // policies, so it lives in the deploy target's env and never in a file.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default('listings'),

  // How long an approved listing stays searchable before the owner has to
  // refresh it. Short enough that a rented room does not linger for months.
  LISTING_TTL_DAYS: z.coerce.number().int().positive().max(90).default(14),

  // Signs access tokens. Every environment needs one now that auth exists;
  // .env.development carries a throwaway value.
  JWT_SECRET: z.string().min(16),
  // Short on purpose: an access token cannot be revoked, only outlived. The
  // refresh token is what keeps a session alive.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'use a number plus s, m, h or d, e.g. 15m')
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),

  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

/**
 * `KEY=` in a template file means "not configured here", not "empty string" —
 * dropping blanks lets optional fields stay optional and defaults apply.
 */
const rawEnv = Object.fromEntries(
  Object.entries({ ...process.env, NODE_ENV }).filter(([, v]) => v !== undefined && v !== '')
);

const parsed = schema.safeParse(rawEnv);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(
    `\n[config] Invalid environment for NODE_ENV="${NODE_ENV}".\n` +
      `Files loaded: ${loadedEnvFiles.join(', ') || '(none)'}\n${issues}\n`
  );
  process.exit(1);
}

const env = parsed.data;

const config = {
  env: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isStaging: env.NODE_ENV === 'staging',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  loadedEnvFiles,

  app: {
    name: env.APP_NAME,
    port: env.PORT,
    host: env.HOST,
    apiPrefix: env.API_PREFIX,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  },

  log: {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  },

  cors: {
    origins: env.CORS_ORIGINS,
    allowAll: env.CORS_ORIGINS.includes('*'),
    // Reflecting the caller's origin AND allowing credentials lets any site
    // call this API with the visitor's cookies, so the two are never combined.
    credentials: !env.CORS_ORIGINS.includes('*'),
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
  },

  db: {
    url: env.DATABASE_URL,
    directUrl: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
    poolMax: env.DB_POOL_MAX,
    idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
  },

  redis: {
    url: env.REDIS_URL,
  },

  storage: {
    url: env.SUPABASE_URL?.replace(/\/+$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.STORAGE_BUCKET,
  },

  listings: {
    ttlDays: env.LISTING_TTL_DAYS,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },
};

// Booting without a database is a local convenience; production would come up
// "healthy" and then 503 every real request.
if (config.isProduction && !config.db.url) {
  console.error('[config] DATABASE_URL is required when NODE_ENV=production.');
  process.exit(1);
}

// A wildcard is a convenience for local work; in production it means every
// site on the internet is an allowed caller, which is never the intent.
if (config.isProduction && config.cors.allowAll) {
  console.error(
    '[config] CORS_ORIGINS="*" is not allowed when NODE_ENV=production.\n' +
      '         List the exact frontend origins, comma-separated.'
  );
  process.exit(1);
}

export default config;
