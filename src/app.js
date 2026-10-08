import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import config from './config/index.js';
import errorHandler from './middlewares/errorHandler.js';
import httpLogger from './middlewares/httpLogger.js';
import notFound from './middlewares/notFound.js';
import rateLimiter from './middlewares/rateLimiter.js';
import requestId from './middlewares/requestId.js';
import response from './middlewares/response.js';
import healthRoutes from './routes/health.route.js';
import apiRoutes from './routes/index.js';

const app = express();

// Behind a load balancer / reverse proxy in staging and production, so the
// real client IP (rate limiting, logs) comes from X-Forwarded-For.
app.set('trust proxy', config.isDevelopment ? false : 1);
app.disable('x-powered-by');

app.use(requestId);
app.use(httpLogger);
app.use(response);

app.use(helmet());
app.use(
  cors({
    origin: config.cors.allowAll ? '*' : config.cors.origins,
    credentials: config.cors.credentials,
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health checks stay outside the rate limiter and the API prefix so probes
// keep working regardless of versioning.
app.use('/health', healthRoutes);

app.use(config.app.apiPrefix, rateLimiter(config.rateLimit.max), apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
