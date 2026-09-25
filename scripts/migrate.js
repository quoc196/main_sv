import { spawnSync } from 'node:child_process';

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

const { status } = spawnSync(
  'node-pg-migrate',
  ['--database-url-var', 'MIGRATE_DATABASE_URL', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: config.db.directUrl },
    shell: false,
  }
);

process.exit(status ?? 1);
