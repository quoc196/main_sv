import pg from 'pg';

import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * A single pool for the process. Nothing outside this module touches `pg`, so
 * swapping the driver later is a change in one file.
 *
 * Postgres returns NUMERIC as a string to avoid the precision loss of a JS
 * float. Keep it that way — silently turning money into a double is how totals
 * end up a cent off.
 */
let pool = null;

export function getPool() {
  if (!pool) throw new Error('Database pool is not initialised — call connect() first');
  return pool;
}

export function isEnabled() {
  return Boolean(config.db.url);
}

export async function connect() {
  if (!isEnabled()) {
    logger.warn('DATABASE_URL is not set — running with the in-memory store');
    return null;
  }
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    idleTimeoutMillis: config.db.idleTimeoutMs,
    connectionTimeoutMillis: config.db.connectTimeoutMs,
  });

  // An error on an idle client (server restart, pooler timeout, scale-to-zero)
  // is emitted on the pool, and an unhandled 'error' here would take the whole
  // process down. pg discards the broken client on its own.
  pool.on('error', (err) => logger.error({ err }, 'Idle database client errored'));

  // Fail during startup rather than on the first user request.
  const { rows } = await pool.query('SELECT version()');
  logger.info({ version: rows[0].version.split(' ').slice(0, 2).join(' ') }, 'Database connected');

  return pool;
}

export async function disconnect() {
  if (!pool) return;
  await pool.end();
  pool = null;
  logger.info('Database connection closed');
}

/** Thin wrapper so callers never hold a client they have to remember to release. */
export function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Runs `fn` inside a transaction on one client, rolling back on any throw.
 * Needed for anything that writes more than one row and must not half-apply.
 */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Readiness probe: cheap, and reports the failure instead of throwing. */
export async function ping() {
  if (!isEnabled()) return { status: 'skipped', reason: 'DATABASE_URL not set' };
  try {
    await getPool().query('SELECT 1');
    return { status: 'ok' };
  } catch (err) {
    logger.error({ err }, 'Database ping failed');
    return { status: 'error', reason: err.message };
  }
}
