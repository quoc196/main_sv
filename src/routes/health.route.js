import { Router } from 'express';
import config from '../config/index.js';

const router = Router();

/** Liveness: the process is up. Keep it dependency-free so it never flaps. */
router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness: add real dependency checks (DB, cache) here as you add them. */
router.get('/ready', async (_req, res) => {
  const checks = {};
  const healthy = Object.values(checks).every((c) => c.status === 'ok');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
  });
});

router.get('/', (_req, res) => {
  res.json({
    status: 'success',
    app: config.app.name,
    env: config.env,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
