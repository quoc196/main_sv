import { Router } from 'express';

import config from '../../config/index.js';
import { requireAuth } from '../../middlewares/auth.js';
import rateLimiter from '../../middlewares/rateLimiter.js';
import validate from '../../middlewares/validate.js';
import * as controller from './auth.controller.js';
import { loginSchema, refreshTokenSchema, registerSchema } from './auth.validation.js';

const router = Router();

// Stacked on top of the API-wide limit. Refresh is left out on purpose: every
// signed-in client calls it on a timer, and its token is not guessable.
const credentialLimiter = rateLimiter(config.rateLimit.authMax);

router.post('/register', credentialLimiter, validate(registerSchema), controller.register);
router.post('/login', credentialLimiter, validate(loginSchema), controller.login);
router.post('/refresh', validate(refreshTokenSchema), controller.refresh);
// Needs only the refresh token: logging out must work after the access token expired.
router.post('/logout', validate(refreshTokenSchema), controller.logout);
router.get('/me', requireAuth, controller.me);

export default router;
