import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';

if (config.cors.allowAll && !config.isTest) {
  logger.warn(
    'CORS_ORIGINS="*" — every origin is allowed, and browsers refuse credentialed ' +
      'requests against a wildcard. Set explicit origins before shipping a browser client.'
  );
}

const server = app.listen(config.app.port, config.app.host, () => {
  logger.info(
    {
      port: config.app.port,
      host: config.app.host,
      apiPrefix: config.app.apiPrefix,
      envFiles: config.loadedEnvFiles,
    },
    `${config.app.name} listening on http://${config.app.host}:${config.app.port}`
  );
});

let shuttingDown = false;

/**
 * `exitCode` is 0 only for a shutdown we asked for. A fatal error leaves the
 * process in an unknown state, and exiting 0 there would tell the orchestrator
 * everything ended normally — no restart, no alert.
 */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, exitCode }, 'Shutting down...');

  // Hard limit: stop waiting for in-flight requests after the grace period.
  const timer = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, config.app.shutdownTimeoutMs);
  timer.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error while closing the HTTP server');
      process.exit(1);
    }

    // Close DB / cache / queue connections here.

    logger.info('Shutdown complete');
    process.exit(exitCode);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

export default server;
