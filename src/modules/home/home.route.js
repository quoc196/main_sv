import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth.js';
import * as controller from './home.controller.js';

const router = Router();

// The home screen is only reachable after login.
router.get('/actions', requireAuth, controller.listActions);

export default router;
