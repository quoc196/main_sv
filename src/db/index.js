import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Placeholder for the real data layer. Wire your driver/ORM here (pg, mongoose,
 * Prisma, ...), then call connect() from server.js before app.listen and
 * disconnect() inside the shutdown handler.
 */
export async function connect() {
  if (!config.db.url) {
    logger.warn('DATABASE_URL is not set — running without a database');
    return null;
  }
  logger.info('Database connection would be established here');
  return null;
}

export async function disconnect() {
  logger.info('Database connection closed');
}
