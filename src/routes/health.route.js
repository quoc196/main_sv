import { Router } from 'express';
import config from '../config/index.js';
import * as db from '../db/index.js';

const router = Router();

/** Liveness: the process is up. Keep it dependency-free so it never flaps. */
router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Readiness: can this instance serve traffic right now? Add a check per
 * dependency the API cannot answer requests without.
 *
 * A 'skipped' check (no DATABASE_URL) is not a failure — it means the app was
 * deliberately started without that dependency.
 */
router.get('/ready', async (_req, res) => {
  const checks = { database: await db.ping() };
  const healthy = Object.values(checks).every((c) => c.status !== 'error');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
  });
});

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    app: config.app.name,
    env: config.env,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
