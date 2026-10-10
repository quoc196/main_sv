import { spawnSync } from 'node:child_process';
import pg from 'pg';

import config from '../src/config/index.js';

/**
 * Wraps the node-pg-migrate CLI so the connection string comes from the same
 * validated config as the app, and so a deploy without a database configured
 * yet is a no-op instead of a failed build.
 *
 * Migrations run on the DIRECT url: a transaction-mode pooler (PgBouncer, as
 * used by Neon and Supabase) cannot hold the advisory lock and session state
 * that node-pg-migrate relies on.
 */
if (!config.db.directUrl) {
  console.log('[migrate] DATABASE_URL is not set — nothing to migrate.');
  process.exit(0);
}

const source = process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED' : 'DATABASE_URL';

function fail(message, hint) {
  console.error(`[migrate] ${message}`);
  if (hint) console.error(`[migrate] Fix: ${hint}`);
  process.exit(1);
}

// ---------------------------------------------------------------- preflight
// A bad connection string used to hang node-pg-migrate silently until the
// build timed out. Checking it here first turns that into a clear error in
// the build log, with the target printed and the password masked.

let url;
try {
  url = new URL(config.db.directUrl);
} catch {
  fail(
    `${source} is not a valid URL.`,
    'the value must start with postgresql:// — no "KEY=" prefix, no quotes — and a password ' +
      'containing # / ? @ must be URL-encoded or replaced with letters and digits.'
  );
}

const target = `${decodeURIComponent(url.username)}:***@${url.hostname}:${url.port || 5432}${url.pathname}`;
console.log(`[migrate] Using ${source}: ${target}`);

const isSupabaseDirect = /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname);
const DIRECT_HINT =
  'this is Supabase\'s "Direct connection" (IPv6 only, unreachable from Render). Use the ' +
  '"Session pooler" string instead: user postgres.<project-ref>, host *.pooler.supabase.com, port 5432.';

if (isSupabaseDirect) console.warn(`[migrate] Warning: ${DIRECT_HINT}`);
if (url.port === '6543') {
  console.warn(
    `[migrate] Warning: port 6543 is a transaction pooler, which migrations cannot use. ` +
      'Set DATABASE_URL_UNPOOLED to the session pooler / direct string (port 5432).'
  );
}

function hintFor(err) {
  if (err.code === '28P01') {
    return `wrong password for ${url.hostname}. Use the database password of THIS project, in both DATABASE_URL and DATABASE_URL_UNPOOLED.`;
  }
  if (/tenant.*not found|no tenant identifier/i.test(err.message)) {
    return (
      'the pooler has no project for this user. The user must be postgres.<project-ref> of a ' +
      'project that still exists (not deleted or paused), and the host must be the pooler of ' +
      "that project's region — copy the Session pooler string from Supabase → Connect."
    );
  }
  if (isSupabaseDirect) return DIRECT_HINT;
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return `host "${url.hostname}" does not exist — check the host part of the string.`;
  }
  if (
    /timeout/i.test(err.message) ||
    ['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(err.code)
  ) {
    return (
      'the database did not answer. Check Supabase → Project Settings → Database → Network Bans ' +
      '(unban the deploy host) and Network Restrictions (must allow all IPs).'
    );
  }
  return undefined;
}

const probe = new pg.Client({
  connectionString: config.db.directUrl,
  connectionTimeoutMillis: 15_000,
});
try {
  await probe.connect();
  await probe.query('SELECT 1');
  await probe.end();
} catch (err) {
  fail(
    `Cannot connect to ${target}: ${err.code ? `${err.code} ` : ''}${err.message}`,
    hintFor(err)
  );
}

// ------------------------------------------------------------------ migrate
const { status, error } = spawnSync(
  'node-pg-migrate',
  ['--database-url-var', 'MIGRATE_DATABASE_URL', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: config.db.directUrl },
    shell: false,
  }
);

// ENOENT: the binary is missing (installed without it) or not on PATH (run as
// `node scripts/migrate.js` outside npm). Say so instead of exiting 1 silently.
if (error) {
  fail(
    `Could not start node-pg-migrate: ${error.message}`,
    'run it as `npm run db:migrate` after a plain `npm ci` — node-pg-migrate is a dependency.'
  );
}

process.exit(status ?? 1);
