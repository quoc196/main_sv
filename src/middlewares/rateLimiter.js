import rateLimit from 'express-rate-limit';

import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import { CODES } from '../utils/response.js';

/** Per-IP limiter over RATE_LIMIT_WINDOW_MS, answering in the standard envelope. */
export default function rateLimiter(max) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
    // Routed through the error handler so a throttled caller gets the same
    // envelope as every other failure, not express-rate-limit's own body.
    handler: (_req, _res, next) => next(new ApiError(429, CODES.TOO_MANY_REQUESTS.message)),
  });
}
