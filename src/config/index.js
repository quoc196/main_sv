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

  // Optional infrastructure — fill in when you plug a real DB / cache in.
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default('1d'),

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
  },

  db: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
};

// Secrets are only truly optional outside production.
if (config.isProduction && !config.jwt.secret) {
  console.error('[config] JWT_SECRET is required when NODE_ENV=production.');
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
